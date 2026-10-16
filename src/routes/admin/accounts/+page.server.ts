import { listAccounts } from '#lib/server/accounts.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = (event) => listAccounts(event);
