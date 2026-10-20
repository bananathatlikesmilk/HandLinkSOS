import { z } from 'zod';
import { privateJson, readInput, requireUser } from '#lib/server/api.ts';
import { setSosFavorite } from '#lib/server/incidents.ts';
import type { RequestHandler } from './$types';

const input = z.strictObject({ favorite: z.boolean() });
export const PUT: RequestHandler = async (event) => {
	requireUser(event);
	const value = await readInput(event, input);
	return privateJson(setSosFavorite(event, event.params.id, value.favorite));
};
