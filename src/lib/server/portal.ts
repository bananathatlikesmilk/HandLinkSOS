import { error, redirect, type RequestEvent } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { resolve } from '$app/paths';
import { db } from './db/index.ts';
import { user } from './db/schema.ts';
import { hasStaffMfa } from './staff-mfa.ts';

export function portalAccount(
	event: RequestEvent,
	role: 'user' | 'dispatcher' | 'admin',
	protectedPage: boolean
) {
	event.setHeaders({ 'Cache-Control': 'no-store' });
	const identity =
		event.locals.user && event.locals.session
			? db.select().from(user).where(eq(user.id, event.locals.user.id)).get()
			: undefined;
	const login =
		role === 'user' ? '/user/login' : role === 'admin' ? '/admin/login' : '/dispatch/login';
	if (!identity) {
		if (protectedPage) redirect(303, resolve(login));
		return null;
	}
	if ((identity.role ?? 'user') !== role) {
		if (protectedPage) error(403, 'This account cannot access this portal.');
		return null;
	}
	if (identity.banned || !identity.emailVerified) {
		if (protectedPage) redirect(303, resolve(login));
		return null;
	}
	if (protectedPage && role !== 'user' && !hasStaffMfa(identity.id, event.locals.session!.id)) {
		redirect(303, resolve(role === 'admin' ? '/admin/security' : '/dispatch/security'));
	}
	return { id: identity.id, name: identity.name, email: identity.email, role };
}
