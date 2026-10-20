import { redirect, error } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { user } from '#lib/server/db/schema.ts';
import { portalAccount } from '#lib/server/portal.ts';
import { hasStaffMfa } from '#lib/server/staff-mfa.ts';
import { emailConfigured } from '#lib/server/email.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = (event) => {
	const identity =
		event.locals.user && event.locals.session
			? db.select().from(user).where(eq(user.id, event.locals.user.id)).get()
			: undefined;
	if (!identity) {
		event.setHeaders({ 'Cache-Control': 'no-store' });
		return { emailConfigured };
	}
	const role = identity.role ?? 'user';
	if (role !== 'user' && role !== 'dispatcher' && role !== 'admin')
		error(403, 'Account role is not supported.');
	const account = portalAccount(event, role, false);
	if (!account) return { emailConfigured };
	if (role === 'user') redirect(303, resolve('/user/dashboard'));
	const verified = hasStaffMfa(account.id, event.locals.session!.id);
	redirect(
		303,
		resolve(
			role === 'admin'
				? verified
					? '/admin'
					: '/admin/security'
				: verified
					? '/dispatch'
					: '/dispatch/security'
		)
	);
};
