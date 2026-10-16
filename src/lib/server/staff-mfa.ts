import { error, redirect, type RequestEvent } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { and, eq, gt } from 'drizzle-orm';
import { db } from './db/index.ts';
import { session, twoFactor, user } from './db/schema.ts';

export function hasStaffMfa(userId: string, sessionId: string) {
	return Boolean(
		db
			.select({ id: session.id })
			.from(session)
			.innerJoin(user, eq(user.id, session.userId))
			.innerJoin(twoFactor, eq(twoFactor.userId, user.id))
			.where(
				and(
					eq(session.id, sessionId),
					eq(user.id, userId),
					gt(session.expiresAt, new Date()),
					eq(user.twoFactorEnabled, true),
					eq(twoFactor.verified, true),
					gt(session.mfaVerifiedAt, new Date(0))
				)
			)
			.get()
	);
}

export function requireStaffSession(event: RequestEvent, role?: 'admin' | 'dispatcher') {
	if (!event.locals.user || !event.locals.session) error(401, 'Sign in first.');
	const identity = db.select().from(user).where(eq(user.id, event.locals.user.id)).get();
	const current = db
		.select()
		.from(session)
		.where(
			and(
				eq(session.id, event.locals.session.id),
				eq(session.userId, event.locals.user.id),
				gt(session.expiresAt, new Date())
			)
		)
		.get();
	if (
		!identity ||
		!current ||
		!identity.emailVerified ||
		identity.banned ||
		!['admin', 'dispatcher'].includes(identity.role ?? '') ||
		(role && identity.role !== role)
	) {
		error(403, 'An active, verified staff account is required.');
	}
	return { identity, current };
}

export function loadStaffSecurity(event: RequestEvent, role: 'admin' | 'dispatcher') {
	if (!event.locals.user || !event.locals.session)
		redirect(303, resolve(role === 'admin' ? '/admin/login' : '/dispatch/login'));
	const { identity, current } = requireStaffSession(event, role);
	return {
		security: {
			email: identity.email,
			enabled: Boolean(identity.twoFactorEnabled),
			mfaVerified: hasStaffMfa(identity.id, current.id)
		}
	};
}
