import { error, type RequestEvent } from '@sveltejs/kit';
import { and, count, eq, ne } from 'drizzle-orm';
import { z } from 'zod';
import { boundaryContains, parseBoundary, PROVINCIAL_LGU_ID } from '../lgu.ts';
import { db } from './db/index.ts';
import {
	incident,
	incidentLgu,
	lgu,
	lguRoutingAudit,
	session,
	staffLgu,
	user
} from './db/schema.ts';
import { requireCentralAdmin, requireCoordinator } from './api.ts';
import { routingLguId } from './lgu-scope.ts';
import { isProvincialIncident } from './incident-workflow.ts';

export const lguInput = z.strictObject({
	name: z.string().trim().min(1).max(100),
	boundary: z.unknown().default(null),
	active: z.boolean().default(false)
});
export const lguAssignmentInput = z.strictObject({ lguId: z.string().min(1).max(100) });

export function listLgus(event: RequestEvent) {
	requireCentralAdmin(event);
	return { lgus: db.select().from(lgu).orderBy(lgu.name).all() };
}
export function requireLgu(id: string) {
	const row = db.select().from(lgu).where(eq(lgu.id, id)).get();
	if (!row) error(422, 'Choose an existing LGU.');
	return row;
}
export function requireActiveLgu(id: string) {
	const row = requireLgu(id);
	if (!row.active) error(422, 'Choose an active LGU.');
	return row;
}
export function saveLgu(
	event: RequestEvent,
	id: string | undefined,
	input: z.output<typeof lguInput>
) {
	requireCentralAdmin(event);
	if (id === PROVINCIAL_LGU_ID)
		error(409, 'Provincial intake is a permanent system queue, not a municipal boundary.');
	let boundary;
	try {
		boundary = parseBoundary(input.boundary);
	} catch (reason) {
		error(422, reason instanceof Error ? reason.message : 'Invalid boundary.');
	}
	if (input.active && !boundary && id !== 'legacy')
		error(422, 'An active LGU needs a valid GPS boundary.');
	return db.transaction(
		(tx) => {
			requireCentralAdmin(event);
			const existing = id ? tx.select().from(lgu).where(eq(lgu.id, id)).get() : undefined;
			if (id && !existing) error(404, 'LGU not found.');
			if (
				existing?.active &&
				!input.active &&
				tx
					.select({ id: incident.id })
					.from(incident)
					.leftJoin(incidentLgu, eq(incidentLgu.incidentId, incident.id))
					.where(and(eq(routingLguId, existing.id), ne(incident.status, 'Resolved')))
					.get()
			)
				error(409, 'Resolve or reroute active incidents before deactivating this LGU.');
			if (
				tx
					.select()
					.from(lgu)
					.where(and(eq(lgu.name, input.name), id ? ne(lgu.id, id) : undefined))
					.get()
			)
				error(409, 'An LGU with this name already exists.');
			if (!id && tx.select({ n: count() }).from(lgu).get()!.n >= 500)
				error(422, 'LGU limit reached.');
			const values = {
				name: input.name,
				boundary,
				active: input.active,
				activatedAt: existing?.activatedAt ?? (input.active && boundary ? new Date() : null)
			};
			const saved = id
				? tx.update(lgu).set(values).where(eq(lgu.id, id)).returning().get()!
				: tx.insert(lgu).values(values).returning().get();
			return { lgu: saved };
		},
		{ behavior: 'immediate' }
	);
}

export function routeEmergencyLocation(point: { latitude: number; longitude: number } | null) {
	const jurisdictions = db.select().from(lgu).all();
	const configured = jurisdictions.filter((row) => row.active && row.boundary);
	if (!jurisdictions.some((row) => row.activatedAt || (row.active && row.boundary)))
		return {
			lguId: jurisdictions.find((row) => row.id === 'legacy')?.active ? 'legacy' : null,
			reason: 'unconfigured'
		};
	if (!point) return { lguId: null, reason: 'beneficiary_location_unavailable' };
	const matches = configured.filter((row) =>
		boundaryContains(row.boundary!, point.latitude, point.longitude)
	);
	return matches.length === 1
		? { lguId: matches[0].id, reason: 'gps' }
		: { lguId: null, reason: matches.length ? 'ambiguous' : 'outside_boundaries' };
}

export function assignIncidentLgu(
	event: RequestEvent,
	id: string,
	lguId: string,
	expectedLguId?: string | null
) {
	return db.transaction(
		(tx) => {
			const actor = requireCoordinator(event);
			requireActiveLgu(lguId);
			if (lguId === PROVINCIAL_LGU_ID) error(422, 'Choose a municipal LGU for assignment.');
			const row = tx.select().from(incident).where(eq(incident.id, id)).get();
			if (!row) error(404, 'Incident not found.');
			if (isProvincialIncident(row.id))
				error(
					409,
					'Provincial dispatch keeps this case. Contact the municipality through its official hotline; do not transfer it in HandLink.'
				);
			if (row.status !== 'Not assigned' || row.dispatcherUserId)
				error(409, 'Only unassigned incidents can be routed.');
			const previous = tx.select().from(incidentLgu).where(eq(incidentLgu.incidentId, id)).get();
			const from = previous ? previous.lguId : 'legacy';
			if (from === lguId) return { ok: true };
			if (expectedLguId !== undefined && from !== expectedLguId)
				error(409, 'Municipal assignment changed. Refresh the incident before assigning it again.');
			tx.insert(incidentLgu)
				.values({ incidentId: id, lguId, reason: 'manual' })
				.onConflictDoUpdate({ target: incidentLgu.incidentId, set: { lguId, reason: 'manual' } })
				.run();
			tx.insert(lguRoutingAudit)
				.values({ incidentId: id, fromLguId: from, toLguId: lguId, actorUserId: actor.id })
				.run();
			return { ok: true };
		},
		{ behavior: 'immediate' }
	);
}

export function assignStaffLgu(event: RequestEvent, userId: string, lguId: string) {
	return db.transaction(
		(tx) => {
			const actor = requireCentralAdmin(event);
			requireLgu(lguId);
			const target = tx.select().from(user).where(eq(user.id, userId)).get();
			if (!target || !['admin', 'dispatcher'].includes(target.role ?? ''))
				error(404, 'Staff account not found.');
			if (lguId === PROVINCIAL_LGU_ID && target.role !== 'dispatcher')
				error(
					422,
					'Only dispatchers can join provincial intake. Provincial oversight uses central Admin accounts.'
				);
			if (target.id === actor.id)
				error(409, 'You cannot remove your own central administrator access.');
			const existing = tx.select().from(staffLgu).where(eq(staffLgu.userId, userId)).get();
			if (existing?.lguId === lguId) return { ok: true };
			if (
				tx
					.select()
					.from(incident)
					.where(and(eq(incident.dispatcherUserId, userId), ne(incident.status, 'Resolved')))
					.get()
			)
				error(409, 'Resolve assigned incidents before moving this staff account.');
			tx.insert(staffLgu)
				.values({ userId, lguId })
				.onConflictDoUpdate({ target: staffLgu.userId, set: { lguId } })
				.run();
			tx.delete(session).where(eq(session.userId, userId)).run();
			return { ok: true };
		},
		{ behavior: 'immediate' }
	);
}
