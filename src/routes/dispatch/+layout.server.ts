import { portalAccount } from '#lib/server/portal.ts';
import { emailConfigured } from '#lib/server/email.ts';
import { hasSeenTutorial } from '#lib/server/tutorial.ts';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = (event) => {
	const account = portalAccount(
		event,
		'dispatcher',
		!['/dispatch/login', '/dispatch/forgot-password', '/dispatch/security'].includes(
			event.url.pathname
		)
	);
	return { account, emailConfigured, tutorialSeen: account ? hasSeenTutorial(account.id) : false };
};
