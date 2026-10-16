import { portalAccount } from '#lib/server/portal.ts';
import { emailConfigured } from '#lib/server/email.ts';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = (event) => ({
	account: portalAccount(
		event,
		'admin',
		!['/admin/login', '/admin/forgot-password', '/admin/security'].includes(event.url.pathname)
	),
	emailConfigured
});
