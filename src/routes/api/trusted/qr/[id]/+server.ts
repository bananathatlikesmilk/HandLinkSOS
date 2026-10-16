import { privateJson, readInput, requireUser } from '#lib/server/api.ts';
import { lockQr } from '#lib/server/trusted.ts';
import { emptyInput } from '#lib/server/validation.ts';
import type { RequestHandler } from './$types';
export const DELETE: RequestHandler = async (event) => {
	requireUser(event);
	await readInput(event, emptyInput);
	return privateJson(lockQr(event, event.params.id));
};
