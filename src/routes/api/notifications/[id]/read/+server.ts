import { z } from 'zod';
import { privateJson, readInput, requireUser } from '#lib/server/api.ts';
import { readNotification } from '#lib/server/notifications.ts';
import type { RequestHandler } from './$types';
export const POST: RequestHandler = async (event) => {
	requireUser(event);
	await readInput(event, z.strictObject({}));
	return privateJson(readNotification(event, event.params.id));
};
