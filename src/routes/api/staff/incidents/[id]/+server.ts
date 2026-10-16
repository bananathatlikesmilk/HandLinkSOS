import { privateJson, readInput, requireStaff } from '#lib/server/api.ts';
import { changeIncident, getIncidentDetail } from '#lib/server/incidents.ts';
import { statusInput } from '#lib/server/validation.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) =>
	privateJson(getIncidentDetail(event, event.params.id));
export const PATCH: RequestHandler = async (event) => {
	requireStaff(event);
	const input = await readInput(event, statusInput);
	return privateJson(changeIncident(event, event.params.id, input.status));
};
