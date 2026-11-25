import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { user, userTutorial } from '#lib/server/db/schema.ts';
import { privateJson, readInput, requireUser, requireStaff } from '#lib/server/api.ts';
import { hasSeenTutorial } from '#lib/server/tutorial.ts';
import type { RequestEvent } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

function tutorialAccount(event: RequestEvent) {
	const role = event.locals.user
		? db.select({ role: user.role }).from(user).where(eq(user.id, event.locals.user.id)).get()?.role
		: null;
	return role === 'admin' || role === 'dispatcher'
		? requireStaff(event)
		: requireUser(event).identity;
}

export const GET: RequestHandler = (event) => {
	return privateJson({ seen: hasSeenTutorial(tutorialAccount(event).id) });
};

export const POST: RequestHandler = async (event) => {
	tutorialAccount(event);
	await readInput(event, z.strictObject({}));
	const identity = tutorialAccount(event);
	db.insert(userTutorial)
		.values({ userId: identity.id, dismissedAt: new Date() })
		.onConflictDoNothing()
		.run();
	return privateJson({ seen: true });
};
