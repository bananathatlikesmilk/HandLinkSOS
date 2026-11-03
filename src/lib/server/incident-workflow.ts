import { eq } from 'drizzle-orm';
import { db } from './db/index.ts';
import { incidentLgu } from './db/schema.ts';
import { PROVINCIAL_LGU_ID } from '../lgu.ts';

export function isProvincialIncident(id: string) {
	return (
		db
			.select({ lguId: incidentLgu.lguId })
			.from(incidentLgu)
			.where(eq(incidentLgu.incidentId, id))
			.get()?.lguId === PROVINCIAL_LGU_ID
	);
}

// Operational scope and personal ownership are separate checks. Callers also check dispatcherUserId.
export function canHandleIncident(
	actor: { role: string | null; provincialDispatcher: boolean },
	id: string
) {
	return actor.role === 'dispatcher' && actor.provincialDispatcher === isProvincialIncident(id);
}
