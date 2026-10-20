import { adminDashboard } from '#lib/server/admin-dashboard.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = (event) => ({ summary: adminDashboard(event) });
