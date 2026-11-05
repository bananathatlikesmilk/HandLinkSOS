import { privateJson, readInput, requireCentralAdmin } from '#lib/server/api.ts';
import {
	adminEmergencyPhone,
	emergencyPhoneInput,
	saveEmergencyPhone
} from '#lib/server/emergency-phone.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) => privateJson(adminEmergencyPhone(event));
export const PUT: RequestHandler = async (event) => {
	requireCentralAdmin(event);
	const input = await readInput(event, emergencyPhoneInput);
	return privateJson(saveEmergencyPhone(event, input.number));
};
