import { privateJson, readInput, requireStaff } from '#lib/server/api.ts';
import { reviewCancellation } from '#lib/server/incidents.ts';
import { cancellationReviewInput } from '#lib/server/validation.ts';
import type { RequestHandler } from './$types';
export const POST: RequestHandler = async (event) => {
	requireStaff(event);
	const input = await readInput(event, cancellationReviewInput);
	return privateJson(reviewCancellation(event, event.params.id, input.decision));
};
