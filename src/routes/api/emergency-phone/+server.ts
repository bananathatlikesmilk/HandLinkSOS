import { privateJson, requireUser } from '#lib/server/api.ts';
import { sosPhoneNumber } from '#lib/server/emergency-phone.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) => {
	requireUser(event);
	return privateJson({ number: sosPhoneNumber() });
};
