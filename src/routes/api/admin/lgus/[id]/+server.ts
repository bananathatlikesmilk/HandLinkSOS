import { privateJson, readInput, requireCentralAdmin } from '#lib/server/api.ts';
import { saveLgu, lguInput } from '#lib/server/lgus.ts';
import type { RequestHandler } from './$types';
export const PUT: RequestHandler = async (event) => {
	requireCentralAdmin(event);
	return privateJson(
		saveLgu(event, event.params.id, await readInput(event, lguInput, 2 * 1024 * 1024))
	);
};
