import { privateJson, readInput, requireUser } from '#lib/server/api.ts';
import { createIncident, listOwnIncidents } from '#lib/server/incidents.ts';
import { incidentInput } from '#lib/server/validation.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) => privateJson(listOwnIncidents(event));
export const POST: RequestHandler = async (event) => {
	requireUser(event);
	const input = await readInput(event, incidentInput);
	const result = createIncident(event, input);
	return privateJson({ incident: result.incident }, result.created ? 201 : 200);
};
