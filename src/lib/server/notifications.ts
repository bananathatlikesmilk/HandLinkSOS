import { error, type RequestEvent } from '@sveltejs/kit';
import { and, count, desc, eq, gt, inArray, isNull } from 'drizzle-orm';
import type { AppNotification, LocationNotification } from '../notifications.ts';
import { db } from './db/index.ts';
import {
	incident,
	incidentReference,
	locationRecipient,
	locationSession,
	notification,
	profile
} from './db/schema.ts';
import { requireUser } from './api.ts';
import { notificationListInput } from './validation.ts';
import { getCancellation } from './incidents.ts';
import { expireLocationSessions } from './location-expiry.ts';
import { activeSharingOwner, sharingCandidates } from './location-policy.ts';
import { sharingStatus } from './sharing.ts';
import { incidentReferenceCode } from './incident-references.ts';

const displayedTypes = ['sos', 'location_shared', 'location_expiring', 'location_expired'] as const;

function locationNotice(
	row: typeof notification.$inferSelect,
	userId: string
): LocationNotification | null {
	const session = row.locationSessionId
		? db.select().from(locationSession).where(eq(locationSession.id, row.locationSessionId)).get()
		: undefined;
	if (!session) return null;
	const owner = activeSharingOwner(db, session.ownerProfileId);
	const isOwner = owner?.user.id === userId;
	const recipient = db
		.select()
		.from(locationRecipient)
		.where(
			and(
				eq(locationRecipient.sessionId, session.id),
				eq(locationRecipient.userId, userId),
				isNull(locationRecipient.revokedAt)
			)
		)
		.get();
	const candidate = recipient
		? sharingCandidates(db, session.ownerProfileId).find((person) => person.userId === userId)
		: undefined;
	const authorized = Boolean(owner && (isOwner || candidate));
	// An old warning cannot disclose an active share after the selected trusted access is removed.
	if (
		row.type === 'location_expiring' &&
		(!authorized || (!isOwner && candidate?.kind === 'emergency_contact'))
	)
		return null;
	return {
		id: row.id,
		type: row.type as LocationNotification['type'],
		sessionId: session.id,
		expiresAt: session.expiresAt.toISOString(),
		ownerName: owner ? `${owner.profile.firstName} ${owner.profile.lastName}` : 'A contact',
		isOwner,
		sessionStatus: authorized ? sharingStatus(session) : 'unavailable',
		createdAt: row.createdAt.toISOString(),
		readAt: row.readAt?.toISOString() ?? null
	};
}

export function listNotifications(event: RequestEvent) {
	requireUser(event);
	expireLocationSessions(db);
	return db.transaction(() => {
		const { identity } = requireUser(event);
		const parsed = notificationListInput.safeParse(Object.fromEntries(event.url.searchParams));
		if (!parsed.success) error(422, 'Invalid notifications page.');
		const owned = and(
			eq(notification.userId, identity.id),
			inArray(notification.type, displayedTypes)
		);
		const total = db.select({ n: count() }).from(notification).where(owned).get()!.n;
		const unreadCount = db
			.select({ n: count() })
			.from(notification)
			.where(and(owned, isNull(notification.readAt)))
			.get()!.n;
		const pageSize = 20;
		const page = Math.min(parsed.data.page, Math.max(1, Math.ceil(total / pageSize)));
		// Active warnings must remain visible even when newer unread notices fill the page.
		const warning =
			db
				.select({ notification })
				.from(notification)
				.innerJoin(locationSession, eq(notification.locationSessionId, locationSession.id))
				.where(
					and(
						eq(notification.userId, identity.id),
						eq(notification.type, 'location_expiring'),
						isNull(notification.readAt),
						isNull(locationSession.cancelledAt),
						gt(locationSession.expiresAt, new Date())
					)
				)
				.orderBy(locationSession.expiresAt)
				.all()
				.map((row) => locationNotice(row.notification, identity.id))
				.find((row) => row?.sessionStatus === 'active') ?? null;
		const rows = db
			.select({
				notification,
				incident,
				reference: incidentReferenceCode,
				firstName: profile.firstName,
				lastName: profile.lastName
			})
			.from(notification)
			.leftJoin(incident, eq(incident.id, notification.incidentId))
			.leftJoin(incidentReference, eq(incidentReference.incidentId, incident.id))
			.leftJoin(profile, eq(profile.id, incident.personProfileId))
			.where(owned)
			.orderBy(desc(isNull(notification.readAt)), desc(notification.createdAt), notification.id)
			.limit(pageSize)
			.offset((page - 1) * pageSize)
			.all();
		return {
			notifications: rows.flatMap((row): AppNotification[] => {
				if (row.notification.type !== 'sos') {
					const notice = locationNotice(row.notification, identity.id);
					return notice ? [notice] : [];
				}
				if (!row.incident) return [];
				return [
					{
						id: row.notification.id,
						type: 'sos',
						incidentId: row.incident.id,
						incidentReference: row.reference,
						callerName: row.incident.callerName,
						personName: `${row.firstName} ${row.lastName}`,
						status: row.incident.status,
						createdAt: row.notification.createdAt.toISOString(),
						readAt: row.notification.readAt?.toISOString() ?? null,
						cancellation: getCancellation(row.incident.id)
					}
				];
			}),
			activeLocationWarning: warning,
			unreadCount,
			total,
			page,
			pageSize
		};
	});
}

export function readNotification(event: RequestEvent, id: string | undefined) {
	return db.transaction(
		(tx) => {
			const { identity } = requireUser(event);
			if (!id || !/^[a-f0-9-]{36}$/i.test(id)) error(400, 'Invalid notification ID.');
			const row = tx
				.select()
				.from(notification)
				.where(
					and(
						eq(notification.id, id),
						eq(notification.userId, identity.id),
						inArray(notification.type, displayedTypes)
					)
				)
				.get();
			if (!row) error(404, 'Notification not found.');
			if (!row.readAt)
				tx.update(notification)
					.set({ readAt: new Date() })
					.where(eq(notification.id, row.id))
					.run();
			return { ok: true };
		},
		{ behavior: 'immediate' }
	);
}
