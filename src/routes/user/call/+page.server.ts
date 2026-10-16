import { requireUser } from '#lib/server/api.ts';
import { getOwnIncident } from '#lib/server/incidents.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = (event) => {
	requireUser(event);
	const id = event.url.searchParams.get('incident');
	return { incident: id === null ? null : getOwnIncident(event, id) };
};
