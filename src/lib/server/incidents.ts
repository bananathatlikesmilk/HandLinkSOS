import { error, type RequestEvent } from '@sveltejs/kit';
import { and, count, desc, eq, gt, isNull, ne, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import type { z } from 'zod';
import type { IncidentDetail, IncidentReport, IncidentSummary } from '../incidents.ts';
import { db } from './db/index.ts';
import {
	emergencyContact,
	incident,
	incidentReference,
	incidentEvent,
	incidentAddendum,
	incidentCancellation,
	notification,
	medicalProfile,
	profile,
	trustedConnection,
	user
} from './db/schema.ts';
import { requireStaff, requireUser } from './api.ts';
import { incidentInput, incidentListInput } from './validation.ts';
import { latestIncidentNote } from './incident-notes.ts';
import { getAiSummaryState } from './ai-summaries.ts';
import { incidentReferenceCode } from './incident-references.ts';

const callerProfile = alias(profile, 'caller_profile');
const dispatcher = alias(user, 'handling_dispatcher');
const summaryColumns = {
	id: incident.id,
	reference: incidentReferenceCode,
	personName: sql<string>`${profile.firstName} || ' ' || ${profile.lastName}`,
	callerName: incident.callerName,
	callerPhone: callerProfile.phone,
	isForSomeoneElse: sql<boolean>`${profile.userId} <> ${incident.callerUserId}`.mapWith(Boolean),
	callerRelationship: incident.callerRelationship,
	status: incident.status,
	dispatcherUserId: incident.dispatcherUserId,
	dispatcherName: dispatcher.name,
	startedAt: incident.startedAt,
	confirmedAt: incident.confirmedAt,
	endedAt: incident.endedAt,
	cancellationPending:
		sql<boolean>`exists(select 1 from ${incidentCancellation} where ${incidentCancellation.incidentId} = ${incident.id} and ${incidentCancellation.decision} = 'pending')`.mapWith(
			Boolean
		)
};
function summaries() {
	return db
		.select(summaryColumns)
		.from(incident)
		.innerJoin(incidentReference, eq(incidentReference.incidentId, incident.id))
		.innerJoin(profile, eq(profile.id, incident.personProfileId))
		.innerJoin(callerProfile, eq(callerProfile.userId, incident.callerUserId))
		.leftJoin(dispatcher, eq(dispatcher.id, incident.dispatcherUserId));
}
function serialize(
	row: Omit<IncidentSummary, 'startedAt' | 'confirmedAt' | 'endedAt'> & {
		startedAt: Date;
		confirmedAt: Date | null;
		endedAt: Date | null;
	}
): IncidentSummary {
	return {
		...row,
		startedAt: row.startedAt.toISOString(),
		confirmedAt: row.confirmedAt?.toISOString() ?? null,
		endedAt: row.endedAt?.toISOString() ?? null
	};
}
function summary(id: string) {
	const row = summaries().where(eq(incident.id, id)).get();
	if (!row) error(404, 'Incident not found.');
	return serialize(row);
}
function target(id: string | undefined) {
	if (!id || !/^[a-f0-9-]{36}$/i.test(id)) error(400, 'Invalid incident ID.');
	const row = db.select().from(incident).where(eq(incident.id, id)).get();
	if (!row) error(404, 'Incident not found.');
	return row;
}

export function listSosTargets(event: RequestEvent) {
	const { ownProfile } = requireUser(event);
	if (!ownProfile) return { targets: [] };
	const approved = db
		.select({
			id: profile.id,
			name: sql<string>`${profile.firstName} || ' ' || ${profile.lastName}`
		})
		.from(trustedConnection)
		.innerJoin(profile, eq(profile.id, trustedConnection.ownerProfileId))
		.innerJoin(user, eq(user.id, profile.userId))
		.where(
			and(
				eq(trustedConnection.requesterProfileId, ownProfile.id),
				eq(trustedConnection.status, 'approved'),
				isNull(trustedConnection.revokedAt),
				isNull(profile.deactivatedAt),
				eq(user.emailVerified, true),
				or(eq(user.role, 'user'), isNull(user.role)),
				or(eq(user.banned, false), isNull(user.banned))
			)
		)
		.all();
	return {
		targets: [
			{ id: ownProfile.id, name: `${ownProfile.firstName} ${ownProfile.lastName}` },
			...approved
		]
	};
}
export function getOwnIncident(event: RequestEvent, id: string) {
	const { identity } = requireUser(event);
	const row = target(id);
	if (row.callerUserId !== identity.id) error(404, 'Incident not found.');
	return summary(row.id);
}

export function listOwnIncidents(event: RequestEvent) {
	const { identity } = requireUser(event);
	return {
		incidents: summaries()
			.where(eq(incident.callerUserId, identity.id))
			.orderBy(desc(incident.startedAt), incident.id)
			.limit(50)
			.all()
			.map(serialize)
	};
}

export function createIncident(event: RequestEvent, input: z.output<typeof incidentInput>) {
	return db.transaction(
		(tx) => {
			const { identity, ownProfile } = requireUser(event);
			if (!ownProfile) error(409, 'Save your personal information before starting SOS.');
			const previous = tx
				.select()
				.from(incident)
				.where(
					and(
						eq(incident.callerUserId, identity.id),
						eq(incident.idempotencyKey, input.idempotencyKey)
					)
				)
				.get();
			if (previous) {
				if (
					previous.personProfileId !== input.personProfileId ||
					previous.latitude !== input.latitude ||
					previous.longitude !== input.longitude ||
					previous.locationLabel !== input.locationLabel
				)
					error(409, 'This SOS retry key was already used with different information.');
				return { incident: summary(previous.id), created: false };
			}
			const person = tx
				.select({ profile, user })
				.from(profile)
				.innerJoin(user, eq(user.id, profile.userId))
				.where(eq(profile.id, input.personProfileId))
				.get();
			if (
				!person ||
				person.profile.deactivatedAt ||
				person.user.banned ||
				!person.user.emailVerified ||
				(person.user.role ?? 'user') !== 'user'
			)
				error(403, 'This profile is not available for SOS.');
			let relationship = '';
			if (person.profile.id !== ownProfile.id) {
				const permission = tx
					.select()
					.from(trustedConnection)
					.where(
						and(
							eq(trustedConnection.ownerProfileId, person.profile.id),
							eq(trustedConnection.requesterProfileId, ownProfile.id),
							eq(trustedConnection.status, 'approved'),
							isNull(trustedConnection.revokedAt)
						)
					)
					.get();
				if (!permission)
					error(403, 'This person has not approved you to send SOS on their behalf.');
				relationship = permission.relationship;
			}
			if (
				tx
					.select({ id: incident.id })
					.from(incident)
					.where(
						and(
							eq(incident.callerUserId, identity.id),
							eq(incident.personProfileId, input.personProfileId),
							ne(incident.status, 'Resolved')
						)
					)
					.get()
			)
				error(409, 'You already have an active SOS for this person. Check your recent alerts.');
			const recent = tx
				.select({ n: count() })
				.from(incident)
				.where(
					and(
						eq(incident.callerUserId, identity.id),
						gt(incident.startedAt, new Date(Date.now() - 60000))
					)
				)
				.get()!.n;
			if (recent >= 10) error(429, 'Too many SOS requests. Wait a minute before trying again.');
			const saved = tx
				.insert(incident)
				.values({
					...input,
					callerUserId: identity.id,
					callerName: `${ownProfile.firstName} ${ownProfile.lastName}`,
					callerRelationship: relationship
				})
				.returning()
				.get();
			tx.insert(incidentEvent)
				.values({ incidentId: saved.id, actorUserId: identity.id, type: 'created' })
				.run();
			if (person.user.id !== identity.id)
				tx.insert(notification)
					.values({
						userId: person.user.id,
						incidentId: saved.id,
						type: 'sos',
						deliveryKey: `sos:${saved.id}:${person.user.id}`
					})
					.run();
			return { incident: summary(saved.id), created: true };
		},
		{ behavior: 'immediate' }
	);
}

export function listStaffIncidents(event: RequestEvent) {
	const actor = requireStaff(event);
	const parsed = incidentListInput.safeParse(Object.fromEntries(event.url.searchParams));
	if (!parsed.success) error(422, 'Invalid incident search, filter, or page.');
	const input = parsed.data;
	const condition = and(
		actor.role === 'dispatcher'
			? input.view === 'reports'
				? eq(incident.dispatcherUserId, actor.id)
				: or(isNull(incident.dispatcherUserId), eq(incident.dispatcherUserId, actor.id))
			: undefined,
		input.view === 'reports' ? ne(incident.status, 'Not assigned') : undefined,
		input.status === 'All'
			? undefined
			: input.status === 'Active'
				? ne(incident.status, 'Resolved')
				: eq(incident.status, input.status),
		input.search
			? sql`instr(lower(${incidentReferenceCode} || ' ' || ${incident.id} || ' ' || ${incident.callerName} || ' ' || ${profile.firstName} || ' ' || ${profile.lastName}), ${input.search.toLowerCase()}) > 0`
			: undefined
	);
	const total = db
		.select({ n: count() })
		.from(incident)
		.innerJoin(incidentReference, eq(incidentReference.incidentId, incident.id))
		.innerJoin(profile, eq(profile.id, incident.personProfileId))
		.where(condition)
		.get()!.n;
	const pageSize = 20;
	const page = Math.min(parsed.data.page, Math.max(1, Math.ceil(total / pageSize)));
	return {
		incidents: summaries()
			.where(condition)
			.orderBy(desc(incident.startedAt), incident.id)
			.limit(pageSize)
			.offset((page - 1) * pageSize)
			.all()
			.map(serialize),
		total,
		page,
		pageSize,
		currentUserId: actor.id
	};
}

function accessibleIncident(event: RequestEvent, id: string | undefined, assignedOnly = false) {
	const actor = requireStaff(event);
	const row = target(id);
	if (
		(assignedOnly && !row.dispatcherUserId) ||
		(actor.role === 'dispatcher' && row.dispatcherUserId && row.dispatcherUserId !== actor.id)
	)
		error(404, 'Incident not found.');
	return { actor, row };
}

function latestNote(id: string) {
	return latestIncidentNote(id)?.notes ?? '';
}

export function getIncidentReport(event: RequestEvent, id: string | undefined): IncidentReport {
	return db.transaction(() => {
		const { row } = accessibleIncident(event, id, true);
		return {
			incident: summary(row.id),
			addenda: db
				.select({
					id: incidentAddendum.id,
					notes: incidentAddendum.notes,
					createdAt: incidentAddendum.createdAt,
					authorName: user.name,
					actorUserId: incidentAddendum.actorUserId
				})
				.from(incidentAddendum)
				.innerJoin(user, eq(user.id, incidentAddendum.actorUserId))
				.where(eq(incidentAddendum.incidentId, row.id))
				.orderBy(incidentAddendum.createdAt, incidentAddendum.id)
				.all()
				.map((item) => ({ ...item, createdAt: item.createdAt.toISOString() })),
			ai: getAiSummaryState(row.id),
			cancellation: getCancellation(row.id),
			callerRelationship: row.callerRelationship,
			latitude: row.latitude,
			longitude: row.longitude,
			locationLabel: row.locationLabel,
			notes: latestNote(row.id)
		};
	});
}

export function addReportAddendum(
	event: RequestEvent,
	id: string | undefined,
	input: { id: string; notes: string }
): IncidentReport {
	return db.transaction(
		(tx) => {
			const { actor, row } = accessibleIncident(event, id, true);
			if (actor.role !== 'dispatcher' || row.dispatcherUserId !== actor.id)
				error(403, 'Only the assigned dispatcher can add a report addendum.');
			if (row.status !== 'Resolved')
				error(409, 'Use incident notes while handling an active incident.');
			const previous = tx
				.select()
				.from(incidentAddendum)
				.where(eq(incidentAddendum.id, input.id))
				.get();
			if (previous) {
				if (
					previous.incidentId !== row.id ||
					previous.actorUserId !== actor.id ||
					previous.notes !== input.notes
				)
					error(409, 'This addendum request ID was already used.');
				return getIncidentReport(event, row.id);
			}
			tx.insert(incidentAddendum)
				.values({ id: input.id, incidentId: row.id, actorUserId: actor.id, notes: input.notes })
				.run();
			// Addenda are append-only. Original notes, resolution, and approved AI source remain unchanged.
			return getIncidentReport(event, row.id);
		},
		{ behavior: 'immediate' }
	);
}

export function getIncidentDetail(event: RequestEvent, id: string | undefined): IncidentDetail {
	return db.transaction(() => {
		const { actor, row } = accessibleIncident(event, id);
		const result: IncidentDetail = {
			noteId: null,
			cancellation: null,
			incident: summary(row.id),
			personal: null,
			medical: null,
			emergencyContacts: [],
			notes: '',
			events: []
		};
		// Medical and registered contact details belong only to the dispatcher who confirmed this incident.
		if (actor.role !== 'dispatcher' || row.dispatcherUserId !== actor.id) return result;
		result.cancellation = getCancellation(row.id);
		const person = db.select().from(profile).where(eq(profile.id, row.personProfileId)).get()!;
		const birth = new Date(`${person.birthday}T00:00:00Z`);
		const now = new Date();
		const beforeBirthday =
			now.getUTCMonth() < birth.getUTCMonth() ||
			(now.getUTCMonth() === birth.getUTCMonth() && now.getUTCDate() < birth.getUTCDate());
		result.personal = {
			firstName: person.firstName,
			lastName: person.lastName,
			age: now.getUTCFullYear() - birth.getUTCFullYear() - Number(beforeBirthday),
			sex: person.sex,
			phone: person.phone,
			latitude: row.latitude,
			longitude: row.longitude,
			locationLabel: row.locationLabel
		};
		const medical = db
			.select()
			.from(medicalProfile)
			.where(eq(medicalProfile.profileId, person.id))
			.get();
		if (medical) {
			result.medical = {
				bloodType: medical.bloodType,
				chronicCondition: medical.chronicCondition,
				allergies: medical.allergies,
				currentMedications: medical.currentMedications,
				additionalInformation: medical.additionalInformation
			};
		}
		result.emergencyContacts = db
			.select({
				firstName: emergencyContact.firstName,
				lastName: emergencyContact.lastName,
				phone: emergencyContact.phone,
				email: emergencyContact.email,
				relationship: emergencyContact.relationship
			})
			.from(emergencyContact)
			.where(eq(emergencyContact.profileId, person.id))
			.all();
		result.events = db
			.select()
			.from(incidentEvent)
			.where(eq(incidentEvent.incidentId, row.id))
			.orderBy(desc(incidentEvent.createdAt), sql`${incidentEvent}.rowid desc`)
			.limit(100)
			.all()
			.map(({ id, type, notes, createdAt }) => ({
				id,
				type,
				notes,
				createdAt: createdAt.toISOString()
			}));
		result.notes = latestNote(row.id);
		result.noteId = latestIncidentNote(row.id)?.id ?? null;
		return result;
	});
}

export function changeIncident(
	event: RequestEvent,
	id: string | undefined,
	action: 'confirm' | 'On route' | 'Resolved' | 'note',
	notes = '',
	expectedNoteId?: string | null
) {
	return db.transaction(
		(tx) => {
			const actor = requireStaff(event);
			if (actor.role !== 'dispatcher') error(403, 'Only dispatchers can handle incidents.');
			const row = target(id);
			if (action === 'confirm') {
				if (row.status !== 'Not assigned' || row.dispatcherUserId)
					error(409, 'This incident has already been assigned.');
				tx.update(incident)
					.set({ status: 'In progress', dispatcherUserId: actor.id, confirmedAt: new Date() })
					.where(eq(incident.id, row.id))
					.run();
			} else {
				if (row.dispatcherUserId !== actor.id)
					error(403, 'Only the assigned dispatcher can update this incident.');
				if (action === 'note') {
					if (row.status === 'Resolved') error(409, 'Resolved incidents cannot be edited.');
					const latest = latestIncidentNote(row.id);
					// An uncertain retry of an identical note must not create another note version.
					if (latest?.notes === notes) return getIncidentDetail(event, row.id);
					if (expectedNoteId !== undefined && expectedNoteId !== (latest?.id ?? null))
						error(
							409,
							'Notes changed in another tab. Copy your draft, refresh, and review before saving.'
						);
				} else {
					if (action === 'Resolved' && getCancellation(row.id)?.decision === 'pending')
						error(409, 'Review pending cancellation first.');
					const expected = action === 'On route' ? 'In progress' : 'On route';
					if (row.status !== expected)
						error(409, `The incident must be ${expected} before this update.`);
					tx.update(incident)
						.set({ status: action, endedAt: action === 'Resolved' ? new Date() : null })
						.where(eq(incident.id, row.id))
						.run();
				}
			}
			tx.insert(incidentEvent)
				.values({
					incidentId: row.id,
					actorUserId: actor.id,
					type:
						action === 'confirm'
							? 'confirmed'
							: action === 'On route'
								? 'on_route'
								: action === 'Resolved'
									? 'resolved'
									: 'note',
					notes
				})
				.run();
			return getIncidentDetail(event, row.id);
		},
		{ behavior: 'immediate' }
	);
}

export function getCancellation(incidentId: string) {
	const row = db
		.select()
		.from(incidentCancellation)
		.where(eq(incidentCancellation.incidentId, incidentId))
		.get();
	if (!row) return null;
	return {
		id: row.id,
		reason: row.reason,
		decision: row.decision,
		requestedAt: row.requestedAt.toISOString(),
		reviewedAt: row.reviewedAt?.toISOString() ?? null,
		reviewedByUserId: row.reviewedByUserId
	};
}

export function requestCancellation(event: RequestEvent, id: string | undefined, reason: string) {
	return db.transaction(
		(tx) => {
			const { identity, ownProfile } = requireUser(event);
			const row = target(id);
			if (!ownProfile || row.personProfileId !== ownProfile.id || row.callerUserId === identity.id)
				error(403, 'Only the person receiving this SOS can request cancellation.');
			if (row.status === 'Resolved') error(409, 'This incident is already resolved.');
			const existing = getCancellation(row.id);
			if (existing) {
				if (existing.decision === 'pending' && existing.reason === reason)
					return { cancellation: existing };
				error(409, 'A cancellation request already exists for this incident.');
			}
			tx.insert(incidentCancellation)
				.values({ incidentId: row.id, requesterUserId: identity.id, reason })
				.run();
			tx.insert(incidentEvent)
				.values({
					incidentId: row.id,
					actorUserId: identity.id,
					type: 'cancellation_requested',
					notes: reason
				})
				.run();
			return { cancellation: getCancellation(row.id) };
		},
		{ behavior: 'immediate' }
	);
}

export function reviewCancellation(
	event: RequestEvent,
	id: string | undefined,
	decision: 'approve' | 'reject'
) {
	return db.transaction(
		(tx) => {
			const actor = requireStaff(event);
			const row = target(id);
			if (actor.role !== 'dispatcher' || row.dispatcherUserId !== actor.id)
				error(403, 'Only the assigned dispatcher can review cancellation.');
			const pending = getCancellation(row.id);
			if (!pending || pending.decision !== 'pending' || row.status === 'Resolved')
				error(409, 'No pending cancellation to review.');
			const now = new Date();
			tx.update(incidentCancellation)
				.set({
					decision: decision === 'approve' ? 'approved' : 'rejected',
					reviewedAt: now,
					reviewedByUserId: actor.id
				})
				.where(eq(incidentCancellation.id, pending.id))
				.run();
			if (decision === 'approve')
				tx.update(incident)
					.set({ status: 'Resolved', endedAt: now })
					.where(eq(incident.id, row.id))
					.run();
			tx.insert(incidentEvent)
				.values({
					incidentId: row.id,
					actorUserId: actor.id,
					type: decision === 'approve' ? 'cancellation_approved' : 'cancellation_rejected'
				})
				.run();
			tx.update(notification)
				.set({ readAt: null })
				.where(and(eq(notification.incidentId, row.id), eq(notification.type, 'sos')))
				.run();
			return { cancellation: getCancellation(row.id) };
		},
		{ behavior: 'immediate' }
	);
}
