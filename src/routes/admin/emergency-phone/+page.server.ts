import { adminEmergencyPhone } from '#lib/server/emergency-phone.ts';
import type { PageServerLoad } from './$types';
export const load: PageServerLoad = (event) => adminEmergencyPhone(event);
