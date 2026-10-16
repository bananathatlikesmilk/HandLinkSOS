import { privateJson } from '#lib/server/api.ts';
import { getIncidentReport } from '#lib/server/incidents.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) =>
	privateJson(getIncidentReport(event, event.params.id));
