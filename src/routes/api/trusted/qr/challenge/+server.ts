import { privateJson, readInput, requireUser } from '#lib/server/api.ts';
import { requestQrCode } from '#lib/server/trusted.ts';
import { emptyInput } from '#lib/server/validation.ts';
import type { RequestHandler } from './$types';
export const POST: RequestHandler = async (event) => {
	requireUser(event);
	await readInput(event, emptyInput);
	return privateJson(await requestQrCode(event), 201);
};
