import { and, desc, eq, gt, inArray, isNull, lte, or } from 'drizzle-orm';
import type { db } from './db/index.ts';
import type { SharingRecipient } from '../sharing.ts';
import {
	emergencyContact,
	locationPoint,
	locationRecipient,
	locationSession,
	profile,
	trustedConnection,
	user
} from './db/schema.ts';

export type SharingExecutor = Pick<typeof db, 'select' | 'update' | 'insert'>;

export function activeSharingOwner(executor: SharingExecutor, profileId: string) {
	return executor
		.select({ profile, user })
		.from(profile)
		.innerJoin(user, eq(user.id, profile.userId))
		.where(
			and(
				eq(profile.id, profileId),
				isNull(profile.deactivatedAt),
				eq(user.emailVerified, true),
				or(eq(user.role, 'user'), isNull(user.role)),
				or(eq(user.banned, false), isNull(user.banned))
			)
		)
		.get();
}

export function sharingCandidates(
	executor: SharingExecutor,
	ownerProfileId: string
): SharingRecipient[] {
	const connections = executor
		.select()
		.from(trustedConnection)
		.where(
			and(
				or(
					eq(trustedConnection.ownerProfileId, ownerProfileId),
					eq(trustedConnection.requesterProfileId, ownerProfileId)
				),
				eq(trustedConnection.status, 'approved'),
				isNull(trustedConnection.revokedAt)
			)
		)
		.all();
	const trustedIds = new Set(
		connections.map((row) =>
			row.ownerProfileId === ownerProfileId ? row.requesterProfileId : row.ownerProfileId
		)
	);
	const contacts = executor
		.select()
		.from(emergencyContact)
		.where(eq(emergencyContact.profileId, ownerProfileId))
		.all()
		.filter((row) => row.linkedUserId);
	if (!trustedIds.size && !contacts.length) return [];
	const matches = executor
		.select({ profile, user })
		.from(profile)
		.innerJoin(user, eq(user.id, profile.userId))
		.where(
			and(
				or(
					trustedIds.size ? inArray(profile.id, [...trustedIds]) : undefined,
					contacts.length
						? inArray(
								user.id,
								contacts.map((row) => row.linkedUserId!)
							)
						: undefined
				),
				isNull(profile.deactivatedAt),
				eq(user.emailVerified, true),
				or(eq(user.role, 'user'), isNull(user.role)),
				or(eq(user.banned, false), isNull(user.banned))
			)
		)
		.all();
	return matches
		.filter((row) => row.profile.id !== ownerProfileId)
		.flatMap((row) => {
			const trusted = trustedIds.has(row.profile.id);
			const contact = contacts.some(
				(entry) =>
					entry.linkedUserId === row.user.id &&
					entry.email.trim().toLowerCase() === row.user.email.toLowerCase()
			);
			if (!trusted && !contact) return [];
			return [
				{
					userId: row.user.id,
					name: `${row.profile.firstName} ${row.profile.lastName}`,
					kind:
						trusted && contact
							? ('both' as const)
							: trusted
								? ('trusted' as const)
								: ('emergency_contact' as const)
				}
			];
		})
		.sort((a, b) => a.name.localeCompare(b.name) || a.userId.localeCompare(b.userId));
}

export function sharedPointForRecipient(
	executor: SharingExecutor,
	ownerProfileId: string,
	recipientUserId: string,
	now = new Date()
) {
	if (
		!activeSharingOwner(executor, ownerProfileId) ||
		!sharingCandidates(executor, ownerProfileId).some((person) => person.userId === recipientUserId)
	)
		return undefined;
	return executor
		.select({
			latitude: locationPoint.latitude,
			longitude: locationPoint.longitude,
			accuracy: locationPoint.accuracy,
			recordedAt: locationPoint.recordedAt
		})
		.from(locationSession)
		.innerJoin(locationRecipient, eq(locationRecipient.sessionId, locationSession.id))
		.innerJoin(locationPoint, eq(locationPoint.sessionId, locationSession.id))
		.where(
			and(
				eq(locationSession.ownerProfileId, ownerProfileId),
				eq(locationRecipient.userId, recipientUserId),
				isNull(locationRecipient.revokedAt),
				isNull(locationSession.cancelledAt),
				gt(locationSession.expiresAt, now),
				lte(locationPoint.recordedAt, now)
			)
		)
		.orderBy(desc(locationPoint.recordedAt), locationPoint.id)
		.get();
}

// Persist revocation so restoring a relationship never revives an old location grant.
export function revokeInvalidLocationRecipients(executor: SharingExecutor, ownerProfileId: string) {
	const eligible = new Set(sharingCandidates(executor, ownerProfileId).map((row) => row.userId));
	const sessions = executor
		.select({ id: locationSession.id })
		.from(locationSession)
		.where(
			and(
				eq(locationSession.ownerProfileId, ownerProfileId),
				isNull(locationSession.cancelledAt),
				gt(locationSession.expiresAt, new Date())
			)
		)
		.all();
	for (const session of sessions) {
		const recipients = executor
			.select()
			.from(locationRecipient)
			.where(and(eq(locationRecipient.sessionId, session.id), isNull(locationRecipient.revokedAt)))
			.all();
		for (const recipient of recipients)
			if (!eligible.has(recipient.userId))
				executor
					.update(locationRecipient)
					.set({ revokedAt: new Date() })
					.where(eq(locationRecipient.id, recipient.id))
					.run();
	}
}
