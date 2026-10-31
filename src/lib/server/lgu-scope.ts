import { error } from '@sveltejs/kit';
import { eq, sql } from 'drizzle-orm';
import { db } from './db/index.ts';
import { incidentLgu, lgu, staffLgu } from './db/schema.ts';

export function staffScope<T extends { id: string; role: string | null }>(actor: T) {
	const membership = db.select().from(staffLgu).where(eq(staffLgu.userId, actor.id)).get();
	const centralAdmin = actor.role === 'admin' && !membership;
	const lguId = membership?.lguId ?? (actor.role === 'dispatcher' ? 'legacy' : null);
	const jurisdiction = lguId ? db.select().from(lgu).where(eq(lgu.id, lguId)).get() : undefined;
	return {
		...actor,
		centralAdmin,
		lguId,
		lguName: jurisdiction?.name ?? null,
		lguActive: jurisdiction?.active ?? centralAdmin
	};
}

export const routingLguId = sql<
	string | null
>`case when ${incidentLgu.incidentId} is null then 'legacy' else ${incidentLgu.lguId} end`;

export function assertIncidentLgu(
	actor: { centralAdmin: boolean; lguId: string | null },
	incidentId: string
) {
	if (actor.centralAdmin) return;
	const saved = db.select().from(incidentLgu).where(eq(incidentLgu.incidentId, incidentId)).get();
	if ((saved ? saved.lguId : 'legacy') !== actor.lguId) error(404, 'Incident not found.');
}
