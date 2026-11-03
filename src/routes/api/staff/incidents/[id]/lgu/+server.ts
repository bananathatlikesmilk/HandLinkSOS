import { privateJson, readInput, requireCoordinator } from '#lib/server/api.ts';
import { assignIncidentLgu, lguAssignmentInput } from '#lib/server/lgus.ts';
import type { RequestHandler } from './$types';
import { z } from 'zod';

const assignment = lguAssignmentInput.extend({
	verballyConfirmed: z.literal(true),
	expectedLguId: z.string().min(1).max(100).nullable()
});

export const PUT: RequestHandler = async (event) => {
	requireCoordinator(event);
	const input = await readInput(event, assignment);
	return privateJson(assignIncidentLgu(event, event.params.id!, input.lguId, input.expectedLguId));
};
