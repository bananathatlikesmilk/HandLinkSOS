import { privateJson, readInput, requireUser } from '#lib/server/api.ts';
import { scanQr } from '#lib/server/trusted.ts';
import { qrScanInput } from '#lib/server/validation.ts';
import type { RequestHandler } from './$types';
export const POST: RequestHandler = async (event) => {
	requireUser(event);
	const input = await readInput(event, qrScanInput);
	const result = scanQr(event, input);
	return privateJson({ connection: result.connection }, result.created ? 201 : 200);
};
