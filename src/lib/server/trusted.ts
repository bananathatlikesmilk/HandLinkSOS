import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { error, type RequestEvent } from '@sveltejs/kit';
import { and, count, desc, eq, gt, isNull, ne, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { BETTER_AUTH_SECRET } from '$app/env/private';
import type { z } from 'zod';
import type { TrustedConnection } from '../trusted.ts';
import { matchingRelationship } from '../relationships.ts';
import { db } from './db/index.ts';
import {
	profile,
	qrInvitation,
	trustedConnection,
	user,
	verificationRequest
} from './db/schema.ts';
import { requireUser } from './api.ts';
import { revokeInvalidLocationRecipients } from './location-policy.ts';
import { emailConfigured, sendCode } from './email.ts';
import type { otpInput, qrScanInput, trustedActionInput } from './validation.ts';

const owner = alias(profile, 'trusted_owner');
const requester = alias(profile, 'trusted_requester');
function requireProfile(event: RequestEvent) {
	const account = requireUser(event);
	if (!account.ownProfile) error(409, 'Save your profile before using trusted profiles.');
	return { identity: account.identity, ownProfile: account.ownProfile };
}
function tokenHash(token: string) {
	return createHash('sha256').update(token).digest('hex');
}
function otpHash(userId: string, requestId: string, code: string) {
	return createHmac('sha256', BETTER_AUTH_SECRET)
		.update(`qr_access:${userId}:${requestId}:${code}`)
		.digest('hex');
}
function records() {
	return db
		.select({
			id: trustedConnection.id,
			invitationId: trustedConnection.invitationId,
			ownerProfileId: trustedConnection.ownerProfileId,
			ownerName: sql<string>`${owner.firstName} || ' ' || ${owner.lastName}`,
			requesterProfileId: trustedConnection.requesterProfileId,
			requesterName: sql<string>`${requester.firstName} || ' ' || ${requester.lastName}`,
			relationship: trustedConnection.relationship,
			status: trustedConnection.status,
			createdAt: trustedConnection.createdAt,
			approvedAt: trustedConnection.approvedAt,
			revokedAt: trustedConnection.revokedAt
		})
		.from(trustedConnection)
		.innerJoin(owner, eq(owner.id, trustedConnection.ownerProfileId))
		.innerJoin(requester, eq(requester.id, trustedConnection.requesterProfileId));
}
function serialize(
	row: Omit<TrustedConnection, 'createdAt' | 'approvedAt' | 'revokedAt'> & {
		createdAt: Date;
		approvedAt: Date | null;
		revokedAt: Date | null;
	}
): TrustedConnection {
	return {
		...row,
		createdAt: row.createdAt.toISOString(),
		approvedAt: row.approvedAt?.toISOString() ?? null,
		revokedAt: row.revokedAt?.toISOString() ?? null
	};
}
function connectionSummary(id: string) {
	const row = records().where(eq(trustedConnection.id, id)).get();
	if (!row) error(404, 'Trusted request not found.');
	return serialize(row);
}
function validId(id: string | undefined) {
	if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
		error(400, 'Invalid request ID.');
	return id;
}
function activeProfile(id: string) {
	return db
		.select({ id: profile.id })
		.from(profile)
		.innerJoin(user, eq(user.id, profile.userId))
		.where(
			and(
				eq(profile.id, id),
				isNull(profile.deactivatedAt),
				eq(user.emailVerified, true),
				or(eq(user.role, 'user'), isNull(user.role)),
				or(eq(user.banned, false), isNull(user.banned))
			)
		)
		.get();
}
function checkConnectionLimit(profileId: string) {
	const total = db
		.select({ n: count() })
		.from(trustedConnection)
		.where(
			and(
				or(
					eq(trustedConnection.ownerProfileId, profileId),
					eq(trustedConnection.requesterProfileId, profileId)
				),
				ne(trustedConnection.status, 'revoked')
			)
		)
		.get()!.n;
	if (total >= 100)
		error(409, 'Trusted-profile limit reached. Remove an existing connection first.');
}

export function listTrusted(event: RequestEvent) {
	return db.transaction(() => {
		const { ownProfile } = requireUser(event);
		if (!ownProfile) return { connections: [], currentProfileId: '' };
		return {
			connections: records()
				.where(
					and(
						or(
							eq(trustedConnection.ownerProfileId, ownProfile.id),
							eq(trustedConnection.requesterProfileId, ownProfile.id)
						),
						ne(trustedConnection.status, 'revoked')
					)
				)
				.orderBy(desc(trustedConnection.createdAt), trustedConnection.id)
				.limit(100)
				.all()
				.map(serialize),
			currentProfileId: ownProfile.id
		};
	});
}

export async function requestQrCode(event: RequestEvent) {
	requireProfile(event);
	if (!emailConfigured) error(503, 'Email delivery is not configured. QR access is unavailable.');
	const code = String(randomInt(0, 1000000)).padStart(6, '0');
	const challenge = db.transaction(
		(tx) => {
			const { identity } = requireProfile(event);
			const now = new Date();
			const recent = tx
				.select({ createdAt: verificationRequest.createdAt })
				.from(verificationRequest)
				.where(
					and(
						eq(verificationRequest.userId, identity.id),
						eq(verificationRequest.purpose, 'qr_access'),
						gt(verificationRequest.createdAt, new Date(now.getTime() - 3600000))
					)
				)
				.orderBy(desc(verificationRequest.createdAt))
				.all();
			if (
				recent.length >= 5 ||
				(recent[0] && now.getTime() - recent[0].createdAt.getTime() < 60000)
			)
				error(429, 'Wait 60 seconds between codes. You can request up to five codes per hour.');
			tx.update(verificationRequest)
				.set({ consumedAt: now })
				.where(
					and(
						eq(verificationRequest.userId, identity.id),
						eq(verificationRequest.purpose, 'qr_access'),
						isNull(verificationRequest.consumedAt)
					)
				)
				.run();
			const id = crypto.randomUUID();
			const expiresAt = new Date(now.getTime() + 300000);
			tx.insert(verificationRequest)
				.values({
					id,
					userId: identity.id,
					purpose: 'qr_access',
					codeHash: otpHash(identity.id, id, code),
					createdAt: now,
					expiresAt
				})
				.run();
			return { requestId: id, expiresAt: expiresAt.toISOString(), email: identity.email };
		},
		{ behavior: 'immediate' }
	);
	try {
		await sendCode(challenge.email, code, 'Unlock your profile QR code');
	} catch {
		db.update(verificationRequest)
			.set({ consumedAt: new Date() })
			.where(eq(verificationRequest.id, challenge.requestId))
			.run();
		error(502, 'Verification email could not be sent. Wait 60 seconds, then try again.');
	}
	return { requestId: challenge.requestId, expiresAt: challenge.expiresAt };
}

export function unlockQr(event: RequestEvent, input: z.output<typeof otpInput>) {
	const result = db.transaction(
		(tx) => {
			const { identity, ownProfile } = requireProfile(event);
			const now = new Date();
			const challenge = tx
				.select()
				.from(verificationRequest)
				.where(
					and(
						eq(verificationRequest.id, input.requestId),
						eq(verificationRequest.userId, identity.id),
						eq(verificationRequest.purpose, 'qr_access')
					)
				)
				.get();
			if (
				!challenge ||
				challenge.consumedAt ||
				challenge.expiresAt <= now ||
				challenge.attempts >= 5
			)
				return null;
			const actual = Buffer.from(otpHash(identity.id, challenge.id, input.code), 'hex');
			const expected = Buffer.from(challenge.codeHash, 'hex');
			if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
				// Commit failed attempts before returning the HTTP error outside this transaction.
				tx.update(verificationRequest)
					.set({ attempts: challenge.attempts + 1 })
					.where(eq(verificationRequest.id, challenge.id))
					.run();
				return null;
			}
			tx.update(verificationRequest)
				.set({ consumedAt: now })
				.where(eq(verificationRequest.id, challenge.id))
				.run();
			tx.update(qrInvitation)
				.set({ consumedAt: now })
				.where(and(eq(qrInvitation.ownerProfileId, ownProfile.id), isNull(qrInvitation.consumedAt)))
				.run();
			const token = randomBytes(32).toString('base64url');
			const expiresAt = new Date(now.getTime() + 600000);
			const invitation = tx
				.insert(qrInvitation)
				.values({
					ownerProfileId: ownProfile.id,
					tokenHash: tokenHash(token),
					createdAt: now,
					expiresAt
				})
				.returning({ id: qrInvitation.id })
				.get();
			return { invitationId: invitation.id, token, expiresAt: expiresAt.toISOString() };
		},
		{ behavior: 'immediate' }
	);
	if (!result)
		error(
			422,
			'Code is invalid, expired, already used, or locked after five attempts. Request a new code.'
		);
	return result;
}

export function lockQr(event: RequestEvent, invitationId: string | undefined) {
	return db.transaction(
		(tx) => {
			const { ownProfile } = requireProfile(event);
			const invitation = tx
				.select()
				.from(qrInvitation)
				.where(
					and(
						eq(qrInvitation.id, validId(invitationId)),
						eq(qrInvitation.ownerProfileId, ownProfile.id)
					)
				)
				.get();
			if (!invitation) error(404, 'QR invitation not found.');
			if (!invitation.consumedAt)
				tx.update(qrInvitation)
					.set({ consumedAt: new Date() })
					.where(eq(qrInvitation.id, invitation.id))
					.run();
			return { ok: true };
		},
		{ behavior: 'immediate' }
	);
}

export function scanQr(event: RequestEvent, input: z.output<typeof qrScanInput>) {
	return db.transaction(
		(tx) => {
			const { ownProfile } = requireProfile(event);
			const invitation = tx
				.select()
				.from(qrInvitation)
				.where(eq(qrInvitation.tokenHash, tokenHash(input.token)))
				.get();
			if (!invitation)
				error(422, 'This QR code is invalid, expired, or already used. Ask for a new code.');
			if (invitation.ownerProfileId === ownProfile.id)
				error(409, 'You cannot add your own QR code.');
			if (!activeProfile(invitation.ownerProfileId)) error(403, 'This profile is unavailable.');
			const existing = tx
				.select()
				.from(trustedConnection)
				.where(
					and(
						eq(trustedConnection.ownerProfileId, invitation.ownerProfileId),
						eq(trustedConnection.requesterProfileId, ownProfile.id)
					)
				)
				.get();
			if (invitation.consumedAt) {
				if (
					existing?.invitationId === invitation.id &&
					existing.status === 'pending' &&
					existing.relationship === input.relationship
				)
					return { connection: connectionSummary(existing.id), created: false };
				error(409, 'This QR code was already used or locked. Ask for a new code.');
			}
			if (invitation.expiresAt <= new Date())
				error(422, 'This QR code has expired. Ask for a new code.');
			if (existing && existing.status !== 'revoked')
				error(409, 'You already have a pending or approved connection with this person.');
			const reverse = tx
				.select()
				.from(trustedConnection)
				.where(
					and(
						eq(trustedConnection.ownerProfileId, ownProfile.id),
						eq(trustedConnection.requesterProfileId, invitation.ownerProfileId),
						ne(trustedConnection.status, 'revoked')
					)
				)
				.get();
			if (reverse && input.relationship !== matchingRelationship(reverse.relationship))
				error(
					422,
					`Your relationship must be ${matchingRelationship(reverse.relationship)} to match their ${reverse.relationship} relationship.`
				);
			checkConnectionLimit(ownProfile.id);
			checkConnectionLimit(invitation.ownerProfileId);
			const now = new Date();
			const values = {
				invitationId: invitation.id,
				relationship: input.relationship,
				status: 'pending' as const,
				approvedAt: null,
				revokedAt: null,
				createdAt: now
			};
			const saved = existing
				? tx
						.update(trustedConnection)
						.set(values)
						.where(eq(trustedConnection.id, existing.id))
						.returning({ id: trustedConnection.id })
						.get()!
				: tx
						.insert(trustedConnection)
						.values({
							...values,
							ownerProfileId: invitation.ownerProfileId,
							requesterProfileId: ownProfile.id
						})
						.returning({ id: trustedConnection.id })
						.get();
			tx.update(qrInvitation)
				.set({ consumedAt: now })
				.where(eq(qrInvitation.id, invitation.id))
				.run();
			return { connection: connectionSummary(saved.id), created: true };
		},
		{ behavior: 'immediate' }
	);
}

export function changeTrusted(
	event: RequestEvent,
	id: string | undefined,
	input: z.output<typeof trustedActionInput>
) {
	return db.transaction(
		(tx) => {
			const { ownProfile } = requireProfile(event);
			const connection = tx
				.select()
				.from(trustedConnection)
				.where(
					and(
						eq(trustedConnection.id, validId(id)),
						or(
							eq(trustedConnection.ownerProfileId, ownProfile.id),
							eq(trustedConnection.requesterProfileId, ownProfile.id)
						)
					)
				)
				.get();
			if (!connection) error(404, 'Trusted request not found.');
			let mutualRequest: TrustedConnection | null = null;
			if (input.action === 'approve') {
				if (connection.ownerProfileId !== ownProfile.id)
					error(403, 'Only the profile owner can approve this request.');
				if (connection.invitationId !== input.invitationId || connection.status === 'revoked')
					error(409, 'This request changed or was removed. Refresh before approving.');
				if (!activeProfile(connection.requesterProfileId))
					error(403, 'The requesting account is unavailable.');
				const expectedRelationship = matchingRelationship(connection.relationship);
				if (input.requestMutual && input.mutualRelationship !== expectedRelationship)
					error(
						422,
						`Your relationship must be ${expectedRelationship} to match their ${connection.relationship} relationship.`
					);
				const reverse = tx
					.select()
					.from(trustedConnection)
					.where(
						and(
							eq(trustedConnection.ownerProfileId, connection.requesterProfileId),
							eq(trustedConnection.requesterProfileId, connection.ownerProfileId)
						)
					)
					.get();
				if (
					reverse &&
					reverse.status !== 'revoked' &&
					reverse.relationship !== expectedRelationship
				)
					error(
						409,
						'The relationships do not match. Remove the incorrect request and scan a new QR code.'
					);
				if (connection.status === 'pending') {
					tx.update(trustedConnection)
						.set({ status: 'approved', approvedAt: new Date() })
						.where(eq(trustedConnection.id, connection.id))
						.run();
					if (input.requestMutual) {
						if (reverse && reverse.status !== 'revoked')
							mutualRequest = connectionSummary(reverse.id);
						else {
							checkConnectionLimit(connection.ownerProfileId);
							checkConnectionLimit(connection.requesterProfileId);
							const values = {
								invitationId: connection.invitationId,
								relationship: input.mutualRelationship!,
								status: 'pending' as const,
								approvedAt: null,
								revokedAt: null,
								createdAt: new Date()
							};
							const saved = reverse
								? tx
										.update(trustedConnection)
										.set(values)
										.where(eq(trustedConnection.id, reverse.id))
										.returning({ id: trustedConnection.id })
										.get()!
								: tx
										.insert(trustedConnection)
										.values({
											...values,
											ownerProfileId: connection.requesterProfileId,
											requesterProfileId: connection.ownerProfileId
										})
										.returning({ id: trustedConnection.id })
										.get();
							mutualRequest = connectionSummary(saved.id);
						}
					}
				}
			} else if (connection.status !== 'revoked') {
				tx.update(trustedConnection)
					.set({ status: 'revoked', revokedAt: new Date() })
					.where(eq(trustedConnection.id, connection.id))
					.run();
				revokeInvalidLocationRecipients(tx, connection.ownerProfileId);
				revokeInvalidLocationRecipients(tx, connection.requesterProfileId);
			}
			return { connection: connectionSummary(connection.id), mutualRequest };
		},
		{ behavior: 'immediate' }
	);
}
