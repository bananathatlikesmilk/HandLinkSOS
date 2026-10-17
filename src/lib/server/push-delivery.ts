import { and, eq, gt, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { Message } from 'firebase-admin/messaging';
import type { db } from './db/index.ts';
import {
	device,
	incident,
	locationRecipient,
	locationSession,
	notification,
	profile,
	pushDelivery,
	session,
	user
} from './db/schema.ts';
import { activeSharingOwner, sharingCandidates } from './location-policy.ts';

const types = ['sos', 'location_shared', 'location_expiring', 'location_expired'] as const;
const maxAge = 15 * 60000;

function eligible(database: typeof db, notice: typeof notification.$inferSelect, now: Date) {
	if (notice.readAt || now.getTime() - notice.createdAt.getTime() > maxAge) return false;
	if (notice.type === 'sos') {
		const row = database
			.select()
			.from(incident)
			.where(eq(incident.id, notice.incidentId ?? ''))
			.get();
		return Boolean(row && row.status !== 'Resolved');
	}
	const sharing = database
		.select()
		.from(locationSession)
		.where(eq(locationSession.id, notice.locationSessionId ?? ''))
		.get();
	if (!sharing || sharing.cancelledAt) return false;
	const owner = activeSharingOwner(database, sharing.ownerProfileId);
	if (!owner) return false;
	if (notice.type === 'location_expired' ? sharing.expiresAt > now : sharing.expiresAt <= now)
		return false;
	if (owner.user.id === notice.userId) return true;
	const recipient = database
		.select()
		.from(locationRecipient)
		.where(
			and(
				eq(locationRecipient.sessionId, sharing.id),
				eq(locationRecipient.userId, notice.userId),
				isNull(locationRecipient.revokedAt)
			)
		)
		.get();
	const candidate = sharingCandidates(database, sharing.ownerProfileId).find(
		(person) => person.userId === notice.userId
	);
	return Boolean(
		recipient &&
		candidate &&
		(notice.type !== 'location_expiring' || candidate.kind !== 'emergency_contact')
	);
}

function activeDevice(database: typeof db, id: string, userId: string, now: Date) {
	return database
		.select({ device })
		.from(device)
		.innerJoin(session, and(eq(device.sessionId, session.id), eq(session.userId, device.userId)))
		.innerJoin(user, eq(user.id, device.userId))
		.innerJoin(profile, eq(profile.userId, user.id))
		.where(
			and(
				eq(device.id, id),
				eq(device.userId, userId),
				isNull(device.revokedAt),
				gt(session.expiresAt, now),
				eq(user.emailVerified, true),
				or(eq(user.banned, false), isNull(user.banned)),
				or(eq(user.role, 'user'), isNull(user.role)),
				isNull(profile.deactivatedAt)
			)
		)
		.get()?.device;
}

export async function deliverPushNotifications(
	database: typeof db,
	send: (message: Message) => Promise<string>,
	timestamp?: Date
) {
	const now = timestamp ?? new Date();
	// The unique key and expiring lease coordinate concurrent server processes.
	const candidates = database
		.select({ notificationId: notification.id, deviceId: device.id })
		.from(notification)
		.innerJoin(
			device,
			and(
				eq(device.userId, notification.userId),
				isNull(device.revokedAt),
				gte(notification.createdAt, device.createdAt)
			)
		)
		.where(
			and(
				inArray(notification.type, types),
				isNull(notification.readAt),
				gte(notification.createdAt, new Date(now.getTime() - maxAge)),
				sql`not exists (select 1 from ${pushDelivery} where ${pushDelivery.notificationId} = ${notification.id} and ${pushDelivery.deviceId} = ${device.id})`
			)
		)
		.limit(100)
		.all();
	for (const row of candidates)
		database
			.insert(pushDelivery)
			.values({ ...row, nextAttemptAt: now })
			.onConflictDoNothing()
			.run();
	const ready = database
		.select()
		.from(pushDelivery)
		.where(
			and(
				eq(pushDelivery.state, 'pending'),
				lte(pushDelivery.nextAttemptAt, now),
				or(isNull(pushDelivery.leaseUntil), lte(pushDelivery.leaseUntil, now))
			)
		)
		.limit(50)
		.all();
	for (const item of ready) {
		const now = timestamp ?? new Date();
		const claimed = database
			.update(pushDelivery)
			.set({
				leaseUntil: new Date(now.getTime() + 300000),
				attempts: sql`${pushDelivery.attempts} + 1`
			})
			.where(
				and(
					eq(pushDelivery.id, item.id),
					eq(pushDelivery.state, 'pending'),
					lte(pushDelivery.nextAttemptAt, now),
					or(isNull(pushDelivery.leaseUntil), lte(pushDelivery.leaseUntil, now))
				)
			)
			.returning()
			.get();
		if (!claimed) continue;
		const notice = database
			.select()
			.from(notification)
			.where(eq(notification.id, item.notificationId))
			.get();
		const target = notice && activeDevice(database, item.deviceId, notice.userId, now);
		if (
			!notice ||
			!target ||
			notice.createdAt < target.createdAt ||
			!eligible(database, notice, now)
		) {
			database
				.update(pushDelivery)
				.set({ state: 'skipped', leaseUntil: null })
				.where(eq(pushDelivery.id, item.id))
				.run();
			continue;
		}
		let ttl = Math.max(0, notice.createdAt.getTime() + maxAge - now.getTime());
		if (notice.type === 'location_expiring') {
			const sharing = database
				.select()
				.from(locationSession)
				.where(eq(locationSession.id, notice.locationSessionId!))
				.get();
			ttl = Math.min(ttl, Math.max(0, sharing!.expiresAt.getTime() - now.getTime()));
		}
		try {
			await send({
				token: target.pushToken,
				notification: {
					title: 'HandLink alert',
					body:
						notice.type === 'sos'
							? 'You have a new SOS update. Open HandLink to review.'
							: 'You have a location-sharing update. Open HandLink to review.'
				},
				data: { screen: 'notifications' },
				android: {
					priority: notice.type === 'sos' ? 'high' : 'normal',
					ttl,
					restrictedPackageName: 'com.handlink.sos',
					notification: { channelId: 'handlink_alerts', tag: notice.id, visibility: 'private' }
				}
			});
			database
				.update(pushDelivery)
				.set({ state: 'sent', acceptedAt: new Date(), leaseUntil: null })
				.where(eq(pushDelivery.id, item.id))
				.run();
		} catch (failure) {
			const code = (failure as { code?: string })?.code;
			const invalid =
				code === 'messaging/registration-token-not-registered' ||
				code === 'messaging/invalid-registration-token';
			if (invalid)
				database
					.update(device)
					.set({ revokedAt: new Date() })
					.where(
						and(
							eq(device.id, target.id),
							eq(device.pushToken, target.pushToken),
							eq(device.sessionId, target.sessionId!)
						)
					)
					.run();
			database
				.update(pushDelivery)
				.set({
					state: invalid || claimed.attempts >= 5 ? 'failed' : 'pending',
					leaseUntil: null,
					nextAttemptAt: new Date(
						now.getTime() + Math.min(60000 * 2 ** (claimed.attempts - 1), 15 * 60000)
					)
				})
				.where(eq(pushDelivery.id, item.id))
				.run();
		}
	}
}
