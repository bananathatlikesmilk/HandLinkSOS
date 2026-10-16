import { privateJson, readInput, requireStaff } from '#lib/server/api.ts';
import { generateAiSummary } from '#lib/server/ai-summaries.ts';
import { aiGenerateInput } from '#lib/server/validation.ts';
import type { RequestHandler } from './$types';
export const POST: RequestHandler = async (event) => {
	requireStaff(event);
	const input = await readInput(event, aiGenerateInput);
	return privateJson(await generateAiSummary(event, event.params.id, input));
};
