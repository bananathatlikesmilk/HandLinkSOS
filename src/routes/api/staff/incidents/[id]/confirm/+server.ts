import { privateJson, readInput, requireStaff } from '#lib/server/api.ts';
import { changeIncident } from '#lib/server/incidents.ts';
import { confirmationInput } from '#lib/server/validation.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	requireStaff(event);
	await readInput(event, confirmationInput);
	return privateJson(changeIncident(event, event.params.id, 'confirm'));
};
