import { privateJson } from '#lib/server/api.ts';
import { unclaimedIncidentSummary } from '#lib/server/incidents.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) => privateJson(unclaimedIncidentSummary(event));
