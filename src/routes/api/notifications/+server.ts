import { privateJson } from '#lib/server/api.ts';
import { listNotifications } from '#lib/server/notifications.ts';
import type { RequestHandler } from './$types';
export const GET: RequestHandler = (event) => privateJson(listNotifications(event));
