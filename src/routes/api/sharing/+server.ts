import { privateJson, readInput, requireUser } from '#lib/server/api.ts';
import { listSharing, startSharing } from '#lib/server/sharing.ts';
import { locationStartInput } from '#lib/server/validation.ts';
import type { RequestHandler } from './$types';
export const GET: RequestHandler = (event) => privateJson(listSharing(event));
export const POST: RequestHandler = async (event) => {
	requireUser(event);
	const input = await readInput(event, locationStartInput);
	return privateJson(startSharing(event, input));
};
