import { privateJson, readInput, requireUser } from '#lib/server/api.ts';
import { updateSharingPoint } from '#lib/server/sharing.ts';
import { locationPointInput } from '#lib/server/validation.ts';
import type { RequestHandler } from './$types';
export const POST: RequestHandler = async (event) => {
	requireUser(event);
	const input = await readInput(event, locationPointInput);
	return privateJson(updateSharingPoint(event, event.params.id, input));
};
