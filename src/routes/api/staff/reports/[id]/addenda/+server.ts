import { privateJson, readInput, requireStaff } from '#lib/server/api.ts';
import { addReportAddendum } from '#lib/server/incidents.ts';
import { addendumInput } from '#lib/server/validation.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	requireStaff(event);
	const input = await readInput(event, addendumInput);
	return privateJson(addReportAddendum(event, event.params.id, input));
};
