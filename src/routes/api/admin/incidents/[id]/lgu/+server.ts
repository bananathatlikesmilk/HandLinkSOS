import { privateJson, readInput, requireCentralAdmin } from '#lib/server/api.ts';
import { assignIncidentLgu, lguAssignmentInput } from '#lib/server/lgus.ts';
import type { RequestHandler } from './$types';
export const PUT: RequestHandler = async (event) => {
	requireCentralAdmin(event);
	const input = await readInput(event, lguAssignmentInput);
	return privateJson(assignIncidentLgu(event, event.params.id!, input.lguId));
};
