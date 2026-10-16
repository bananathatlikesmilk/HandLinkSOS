import { privateJson, readInput, requireAdmin } from '#lib/server/api.ts';
import { setAccountActive } from '#lib/server/accounts.ts';
import { accountStatusInput } from '#lib/server/validation.ts';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async (event) => {
	requireAdmin(event);
	const input = await readInput(event, accountStatusInput);
	return privateJson(setAccountActive(event, event.params.id, input.active));
};
