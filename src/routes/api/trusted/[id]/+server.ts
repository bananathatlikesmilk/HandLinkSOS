import { privateJson, readInput, requireUser } from '#lib/server/api.ts';
import { changeTrusted } from '#lib/server/trusted.ts';
import { trustedActionInput } from '#lib/server/validation.ts';
import type { RequestHandler } from './$types';
export const PATCH: RequestHandler = async (event) => {
	requireUser(event);
	const input = await readInput(event, trustedActionInput);
	return privateJson(changeTrusted(event, event.params.id, input));
};
