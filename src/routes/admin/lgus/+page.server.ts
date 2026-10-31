import { listLgus } from '#lib/server/lgus.ts';
import type { PageServerLoad } from './$types';
export const load: PageServerLoad = (event) => listLgus(event);
