import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '#lib/server/db/index.ts';
import { userTutorial } from '#lib/server/db/schema.ts';
import { privateJson, readInput, requireUser } from '#lib/server/api.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) => {
	const { identity } = requireUser(event);
	return privateJson({
		seen: !!db.select().from(userTutorial).where(eq(userTutorial.userId, identity.id)).get()
	});
};

export const POST: RequestHandler = async (event) => {
	requireUser(event);
	await readInput(event, z.strictObject({}));
	const { identity } = requireUser(event);
	db.insert(userTutorial)
		.values({ userId: identity.id, dismissedAt: new Date() })
		.onConflictDoNothing()
		.run();
	return privateJson({ seen: true });
};
