import { privateJson, readInput, requireUser } from '#lib/server/api.ts';
import { unlockQr } from '#lib/server/trusted.ts';
import { otpInput } from '#lib/server/validation.ts';
import type { RequestHandler } from './$types';
export const POST: RequestHandler = async (event) => {
	requireUser(event);
	const input = await readInput(event, otpInput);
	return privateJson(unlockQr(event, input), 201);
};
