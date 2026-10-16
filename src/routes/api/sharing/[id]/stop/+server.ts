import { z } from 'zod';
import { privateJson, readInput, requireUser } from '#lib/server/api.ts';
import { stopSharing } from '#lib/server/sharing.ts';
import type { RequestHandler } from './$types';
export const POST: RequestHandler = async (event) => {
	requireUser(event);
	await readInput(event, z.strictObject({}));
	return privateJson(stopSharing(event, event.params.id));
};
