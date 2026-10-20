import { privateJson } from '#lib/server/api.ts';
import { adminDashboard } from '#lib/server/admin-dashboard.ts';
import type { RequestHandler } from './$types';
export const GET: RequestHandler = (event) => privateJson(adminDashboard(event));
