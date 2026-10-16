import { portalAccount } from '#lib/server/portal.ts';
import { emailConfigured } from '#lib/server/email.ts';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = (event) => ({
	account: portalAccount(
		event,
		'dispatcher',
		!['/dispatch/login', '/dispatch/forgot-password', '/dispatch/security'].includes(
			event.url.pathname
		)
	),
	emailConfigured
});
