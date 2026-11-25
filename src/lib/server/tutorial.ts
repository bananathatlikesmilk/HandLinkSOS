import { eq } from 'drizzle-orm';
import { db } from './db/index.ts';
import { userTutorial } from './db/schema.ts';

export function hasSeenTutorial(accountId: string) {
	return !!db.select().from(userTutorial).where(eq(userTutorial.userId, accountId)).get();
}
