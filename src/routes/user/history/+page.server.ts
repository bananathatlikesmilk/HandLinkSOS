import { listOwnIncidents } from '#lib/server/incidents.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = (event) => {
	// Full history always uses the paginated response, including its first page.
	const url = new URL(event.url);
	if (!url.searchParams.has('page')) url.searchParams.set('page', '1');
	return listOwnIncidents({ ...event, url });
};
