import { privateJson, readInput, requireUser } from '#lib/server/api.ts';
import { requestCancellation } from '#lib/server/incidents.ts';
import { cancellationInput } from '#lib/server/validation.ts';
import type { RequestHandler } from './$types';
export const POST: RequestHandler = async (event) => {
	requireUser(event);
	const input = await readInput(event, cancellationInput);
	return privateJson(requestCancellation(event, event.params.id, input.reason));
};
