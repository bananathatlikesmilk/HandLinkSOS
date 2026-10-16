import { and, eq, gt, isNull, lte } from 'drizzle-orm';
import type { db } from './db/index.ts';
import { locationRecipient, locationSession, notification } from './db/schema.ts';
import { activeSharingOwner, sharingCandidates, type SharingExecutor } from './location-policy.ts';

function selectedRecipients(
	executor: SharingExecutor,
	session: typeof locationSession.$inferSelect
) {
	const selected = new Set(
		executor
			.select({ userId: locationRecipient.userId })
			.from(locationRecipient)
			.where(and(eq(locationRecipient.sessionId, session.id), isNull(locationRecipient.revokedAt)))
			.all()
			.map((person) => person.userId)
	);
	return sharingCandidates(executor, session.ownerProfileId).filter((person) =>
		selected.has(person.userId)
	);
}

// Durable database markers and unique delivery keys make overlapping sweeps safe.
export function expireLocationSessions(database: typeof db, now = new Date()) {
	return database.transaction(
		(tx) => {
			const endingSoon = tx
				.select()
				.from(locationSession)
				.where(
					and(
						gt(locationSession.expiresAt, now),
						lte(locationSession.expiresAt, new Date(now.getTime() + 60000)),
						isNull(locationSession.cancelledAt)
					)
				)
				.all();
			for (const row of endingSoon) {
				const owner = activeSharingOwner(tx, row.ownerProfileId);
				if (!owner) continue;
				const trusted = selectedRecipients(tx, row).filter(
					(person) => person.kind !== 'emergency_contact'
				);
				for (const userId of new Set([owner.user.id, ...trusted.map((person) => person.userId)])) {
					tx.insert(notification)
						.values({
							userId,
							locationSessionId: row.id,
							type: 'location_expiring',
							deliveryKey: `location_expiring:${row.id}:${userId}`,
							createdAt: now
						})
						.onConflictDoNothing({ target: notification.deliveryKey })
						.run();
				}
			}
			const expired = tx
				.select()
				.from(locationSession)
				.where(
					and(
						lte(locationSession.expiresAt, now),
						isNull(locationSession.cancelledAt),
						isNull(locationSession.expiryNotifiedAt)
					)
				)
				.limit(100)
				.all();
			for (const row of expired) {
				const owner = activeSharingOwner(tx, row.ownerProfileId);
				if (owner) {
					const recipients = selectedRecipients(tx, row);
					for (const userId of new Set([
						owner.user.id,
						...recipients.map((person) => person.userId)
					])) {
						tx.insert(notification)
							.values({
								userId,
								locationSessionId: row.id,
								type: 'location_expired',
								deliveryKey: `location_expired:${row.id}:${userId}`,
								createdAt: now
							})
							.onConflictDoNothing({ target: notification.deliveryKey })
							.run();
					}
				}
				tx.update(locationSession)
					.set({ expiryNotifiedAt: now })
					.where(eq(locationSession.id, row.id))
					.run();
			}
			return expired.length;
		},
		{ behavior: 'immediate' }
	);
}
