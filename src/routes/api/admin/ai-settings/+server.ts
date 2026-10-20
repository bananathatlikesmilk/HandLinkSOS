import { privateJson, readInput, requireAdmin } from '#lib/server/api.ts';
import { adminAiSettings, saveAiSettings } from '#lib/server/ai-settings.ts';
import { aiSettingsInput } from '#lib/server/validation.ts';
import type { RequestHandler } from './$types';
export const GET: RequestHandler = (event) => privateJson(adminAiSettings(event));
export const PUT: RequestHandler = async (event) => {
	requireAdmin(event);
	const input = await readInput(event, aiSettingsInput);
	return privateJson(saveAiSettings(event, input.provider));
};
