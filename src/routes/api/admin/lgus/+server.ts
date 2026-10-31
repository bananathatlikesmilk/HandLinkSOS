import { privateJson, readInput, requireCentralAdmin } from '#lib/server/api.ts';
import { listLgus, saveLgu, lguInput } from '#lib/server/lgus.ts';
import type { RequestHandler } from './$types';
export const GET: RequestHandler = (event) => privateJson(listLgus(event));
export const POST: RequestHandler = async (event) => {
	requireCentralAdmin(event);
	return privateJson(
		saveLgu(event, undefined, await readInput(event, lguInput, 2 * 1024 * 1024)),
		201
	);
};
