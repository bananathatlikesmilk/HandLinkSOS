import { sql } from 'drizzle-orm';
import { incidentReference } from './db/schema.ts';

// Formatting stays in SQL so larger reference numbers never lose integer precision in JavaScript.
export const incidentReferenceCode = sql<string>`'HL-' || printf('%07d', ${incidentReference.number})`;
