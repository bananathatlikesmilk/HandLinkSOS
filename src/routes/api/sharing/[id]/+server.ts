import { privateJson } from '#lib/server/api.ts';
import { getSharing } from '#lib/server/sharing.ts';
import type { RequestHandler } from './$types';
export const GET: RequestHandler = (event) => privateJson(getSharing(event, event.params.id));
