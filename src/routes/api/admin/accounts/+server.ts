import { privateJson, readInput, requireAdmin } from '#lib/server/api.ts';
import { createStaffAccount, listAccounts } from '#lib/server/accounts.ts';
import { staffAccountInput } from '#lib/server/validation.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) => privateJson(listAccounts(event));
export const POST: RequestHandler = async (event) => {
	requireAdmin(event);
	const input = await readInput(event, staffAccountInput);
	const account = await createStaffAccount(event, input);
	return privateJson({ account }, 201);
};
