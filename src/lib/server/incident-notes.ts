import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from './db/index.ts';
import { incidentEvent } from './db/schema.ts';

export function latestIncidentNote(id: string) {
	return db
		.select()
		.from(incidentEvent)
		.where(and(eq(incidentEvent.incidentId, id), eq(incidentEvent.type, 'note')))
		.orderBy(desc(incidentEvent.createdAt), sql`${incidentEvent}.rowid desc`)
		.get();
}
