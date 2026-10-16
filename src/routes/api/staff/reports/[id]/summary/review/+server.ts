import { privateJson, readInput, requireStaff } from '#lib/server/api.ts';
import { approveAiSummary } from '#lib/server/ai-summaries.ts';
import { aiReviewInput } from '#lib/server/validation.ts';
import type { RequestHandler } from './$types';
export const POST: RequestHandler = async (event) => {
	requireStaff(event);
	const input = await readInput(event, aiReviewInput);
	return privateJson(approveAiSummary(event, event.params.id, input));
};
