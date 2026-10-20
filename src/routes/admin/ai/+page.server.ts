import { adminAiSettings } from '#lib/server/ai-settings.ts';
import type { PageServerLoad } from './$types';
export const load: PageServerLoad = (event) => ({ settings: adminAiSettings(event) });
