import { loadStaffSecurity } from '#lib/server/staff-mfa.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = (event) => loadStaffSecurity(event, 'admin');
