import { privateJson } from '#lib/server/api.ts';
import { reportFilterOptions } from '#lib/server/incidents.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) => privateJson(reportFilterOptions(event));
