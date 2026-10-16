import { error, type RequestEvent } from '@sveltejs/kit';
import { and, count, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { SharedLocationSession } from '../sharing.ts';
import { db } from './db/index.ts';
import { locationPoint, locationRecipient, locationSession, notification } from './db/schema.ts';
import { requireUser } from './api.ts';
import { activeSharingOwner, sharingCandidates } from './location-policy.ts';
import { expireLocationSessions } from './location-expiry.ts';
import type { locationPointInput, locationStartInput } from './validation.ts';

export function sharingTarget(id: string | undefined) {
	if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
		error(400, 'Invalid sharing ID.');
	const row = db.select().from(locationSession).where(eq(locationSession.id, id)).get();
	if (!row) error(404, 'Sharing session not found.');
	return row;
}

export function sharingStatus(row: typeof locationSession.$inferSelect) {
	return row.cancelledAt
		? ('cancelled' as const)
		: row.expiresAt <= new Date()
			? ('expired' as const)
			: ('active' as const);
}

function latestPoint(id: string) {
	return db
		.select()
		.from(locationPoint)
		.where(eq(locationPoint.sessionId, id))
		.orderBy(desc(locationPoint.recordedAt), locationPoint.id)
		.get();
}

function serialize(
	row: typeof locationSession.$inferSelect,
	userId: string
): SharedLocationSession {
	const owner = activeSharingOwner(db, row.ownerProfileId);
	if (!owner) error(404, 'Sharing session not available.');
	const isOwner = owner.user.id === userId;
	const candidates = sharingCandidates(db, row.ownerProfileId);
	const recipients = db
		.select()
		.from(locationRecipient)
		.where(and(eq(locationRecipient.sessionId, row.id), isNull(locationRecipient.revokedAt)))
		.all();
	if (
		!isOwner &&
		(!recipients.some((person) => person.userId === userId) ||
			!candidates.some((person) => person.userId === userId))
	)
		error(404, 'Sharing session not available.');
	const status = sharingStatus(row);
	if (!isOwner && status !== 'active') error(410, 'Location sharing has ended.');
	const point = status === 'active' ? latestPoint(row.id) : undefined;
	return {
		id: row.id,
		ownerName: `${owner.profile.firstName} ${owner.profile.lastName}`,
		startedAt: row.startedAt.toISOString(),
		expiresAt: row.expiresAt.toISOString(),
		cancelledAt: row.cancelledAt?.toISOString() ?? null,
		status,
		isOwner,
		point: point
			? {
					latitude: point.latitude,
					longitude: point.longitude,
					accuracy: point.accuracy,
					recordedAt: point.recordedAt.toISOString()
				}
			: null,
		recipients: isOwner
			? candidates.filter((person) =>
					recipients.some((recipient) => recipient.userId === person.userId)
				)
			: []
	};
}

export function listSharing(event: RequestEvent) {
	const { identity } = requireUser(event);
	expireLocationSessions(db);
	return db.transaction(() => {
		const { ownProfile } = requireUser(event);
		const latest = ownProfile
			? db
					.select()
					.from(locationSession)
					.where(eq(locationSession.ownerProfileId, ownProfile.id))
					.orderBy(desc(locationSession.startedAt), sql`${locationSession}.rowid desc`)
					.get()
			: undefined;
		const incoming = db
			.select({ session: locationSession })
			.from(locationRecipient)
			.innerJoin(locationSession, eq(locationSession.id, locationRecipient.sessionId))
			.where(
				and(
					eq(locationRecipient.userId, identity.id),
					isNull(locationRecipient.revokedAt),
					isNull(locationSession.cancelledAt),
					gt(locationSession.expiresAt, new Date())
				)
			)
			.orderBy(desc(locationSession.startedAt), locationSession.id)
			.limit(100)
			.all();
		return {
			own: latest ? serialize(latest, identity.id) : null,
			recipients: ownProfile ? sharingCandidates(db, ownProfile.id) : [],
			incoming: incoming.flatMap(({ session }) => {
				if (
					!activeSharingOwner(db, session.ownerProfileId) ||
					!sharingCandidates(db, session.ownerProfileId).some(
						(person) => person.userId === identity.id
					)
				)
					return [];
				return [serialize(session, identity.id)];
			})
		};
	});
}

export function getSharing(event: RequestEvent, id: string | undefined) {
	const { identity } = requireUser(event);
	expireLocationSessions(db);
	return db.transaction(() => ({ session: serialize(sharingTarget(id), identity.id) }));
}

export function startSharing(event: RequestEvent, input: z.output<typeof locationStartInput>) {
	return db.transaction(
		(tx) => {
			const { identity, ownProfile } = requireUser(event);
			if (!ownProfile) error(409, 'Save your profile before sharing your location.');
			const previous = tx
				.select()
				.from(locationSession)
				.where(eq(locationSession.id, input.id))
				.get();
			if (previous) {
				if (previous.ownerProfileId !== ownProfile.id)
					error(409, 'This sharing request ID is unavailable.');
				const recipients = tx
					.select()
					.from(locationRecipient)
					.where(eq(locationRecipient.sessionId, previous.id))
					.all()
					.map((row) => row.userId)
					.sort();
				if (
					previous.expiresAt.getTime() - previous.startedAt.getTime() !==
						input.durationMinutes * 60000 ||
					JSON.stringify(recipients) !== JSON.stringify([...input.recipientUserIds].sort())
				)
					error(409, 'This sharing request ID was already used with different settings.');
				return { session: serialize(previous, identity.id) };
			}
			const now = new Date();
			if (
				tx
					.select({ id: locationSession.id })
					.from(locationSession)
					.where(
						and(
							eq(locationSession.ownerProfileId, ownProfile.id),
							isNull(locationSession.cancelledAt),
							gt(locationSession.expiresAt, now)
						)
					)
					.get()
			)
				error(409, 'You already have an active location sharing session.');
			const recent = tx
				.select({ n: count() })
				.from(locationSession)
				.where(
					and(
						eq(locationSession.ownerProfileId, ownProfile.id),
						gt(locationSession.startedAt, new Date(now.getTime() - 3600000))
					)
				)
				.get()!.n;
			if (recent >= 10) error(429, 'You can start up to ten sharing sessions per hour.');
			const eligible = new Set(sharingCandidates(tx, ownProfile.id).map((person) => person.userId));
			if (input.recipientUserIds.some((id) => !eligible.has(id)))
				error(403, 'Choose only approved trusted people or verified linked emergency contacts.');
			const saved = tx
				.insert(locationSession)
				.values({
					id: input.id,
					ownerProfileId: ownProfile.id,
					startedAt: now,
					expiresAt: new Date(now.getTime() + input.durationMinutes * 60000)
				})
				.returning()
				.get();
			tx.insert(locationPoint)
				.values({
					sessionId: saved.id,
					latitude: input.point.latitude,
					longitude: input.point.longitude,
					accuracy: input.point.accuracy,
					recordedAt: now
				})
				.run();
			for (const userId of input.recipientUserIds) {
				tx.insert(locationRecipient).values({ sessionId: saved.id, userId }).run();
				tx.insert(notification)
					.values({
						userId,
						locationSessionId: saved.id,
						type: 'location_shared',
						deliveryKey: `location_shared:${saved.id}:${userId}`
					})
					.run();
			}
			return { session: serialize(saved, identity.id) };
		},
		{ behavior: 'immediate' }
	);
}

export function updateSharingPoint(
	event: RequestEvent,
	id: string | undefined,
	input: z.output<typeof locationPointInput>
) {
	return db.transaction(
		(tx) => {
			const { identity, ownProfile } = requireUser(event);
			const row = sharingTarget(id);
			if (!ownProfile || ownProfile.id !== row.ownerProfileId)
				error(404, 'Sharing session not found.');
			if (sharingStatus(row) !== 'active') error(409, 'Location sharing has ended.');
			const previous = latestPoint(row.id);
			const now = new Date();
			if (previous && now.getTime() - previous.recordedAt.getTime() < 300000)
				error(429, 'Location updates are limited to once every five minutes.');
			// Keep only the latest received position; do not accumulate a movement history.
			const point = {
				latitude: input.latitude,
				longitude: input.longitude,
				accuracy: input.accuracy,
				recordedAt: now
			};
			if (previous)
				tx.update(locationPoint).set(point).where(eq(locationPoint.id, previous.id)).run();
			else
				tx.insert(locationPoint)
					.values({ ...point, sessionId: row.id })
					.run();
			return { session: serialize(row, identity.id) };
		},
		{ behavior: 'immediate' }
	);
}

export function stopSharing(event: RequestEvent, id: string | undefined) {
	return db.transaction(
		(tx) => {
			const { identity, ownProfile } = requireUser(event);
			const row = sharingTarget(id);
			if (!ownProfile || ownProfile.id !== row.ownerProfileId)
				error(404, 'Sharing session not found.');
			if (sharingStatus(row) === 'active')
				tx.update(locationSession)
					.set({ cancelledAt: new Date() })
					.where(eq(locationSession.id, row.id))
					.run();
			return { session: serialize(sharingTarget(row.id), identity.id) };
		},
		{ behavior: 'immediate' }
	);
}
