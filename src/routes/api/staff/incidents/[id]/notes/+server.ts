import { privateJson, readInput, requireStaff } from '#lib/server/api.ts';
import { changeIncident } from '#lib/server/incidents.ts';
import { noteInput } from '#lib/server/validation.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	requireStaff(event);
	const input = await readInput(event, noteInput);
	return privateJson(changeIncident(event, event.params.id, 'note', input.notes));
};
