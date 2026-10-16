import { error, json, type RequestEvent } from '@sveltejs/kit';
import { and, eq, gt } from 'drizzle-orm';
import type { z } from 'zod';
import { db } from './db/index.ts';
import { profile, session, user } from './db/schema.ts';
import { hasStaffMfa } from './staff-mfa.ts';

function currentAccount(event: RequestEvent) {
	if (!event.locals.user || !event.locals.session) error(401, 'Sign in first.');
	// Read current identity and session again after async work, including inside write transactions.
	const identity = db.select().from(user).where(eq(user.id, event.locals.user.id)).get();
	const activeSession = db
		.select({ id: session.id })
		.from(session)
		.where(
			and(
				eq(session.id, event.locals.session.id),
				eq(session.userId, event.locals.user.id),
				gt(session.expiresAt, new Date())
			)
		)
		.get();
	if (!identity || !activeSession || !identity.emailVerified || identity.banned) {
		error(403, 'Account is not available.');
	}
	return { identity, activeSession };
}

export function requireAdmin(event: RequestEvent) {
	const { identity, activeSession } = currentAccount(event);
	if (identity.role !== 'admin') error(403, 'Administrator access is required.');
	if (!hasStaffMfa(identity.id, activeSession.id))
		error(403, 'Complete staff MFA setup and verification first.');
	return identity;
}

export function requireStaff(event: RequestEvent) {
	const { identity, activeSession } = currentAccount(event);
	if (identity.role !== 'dispatcher' && identity.role !== 'admin')
		error(403, 'Staff access is required.');
	if (!hasStaffMfa(identity.id, activeSession.id))
		error(403, 'Complete staff MFA setup and verification first.');
	return identity;
}

export function requireUser(event: RequestEvent) {
	const { identity } = currentAccount(event);
	if ((identity.role ?? 'user') !== 'user') error(403, 'This API is for User accounts.');
	const ownProfile = db.select().from(profile).where(eq(profile.userId, identity.id)).get();
	if (ownProfile?.deactivatedAt) error(403, 'Account is deactivated.');
	return { identity, ownProfile };
}

export async function readInput<T extends z.ZodType>(
	event: RequestEvent,
	schema: T
): Promise<z.output<T>> {
	// Cookie-authenticated writes require a same-origin browser request.
	if (event.request.headers.get('origin') !== event.url.origin)
		error(403, 'Request origin is not allowed.');
	if (event.request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json')
		error(415, 'Send application/json.');
	const limit = 32768;
	const length = Number(event.request.headers.get('content-length'));
	if (Number.isFinite(length) && length > limit) error(413, 'Request is too large.');
	// Bound reads even when Content-Length is absent or dishonest.
	const reader = event.request.body?.getReader();
	if (!reader) error(400, 'Request body is required.');
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > limit) {
				await reader.cancel();
				error(413, 'Request is too large.');
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
	let body: unknown;
	try {
		body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
	} catch {
		error(400, 'Invalid JSON.');
	}
	const result = schema.safeParse(body);
	if (!result.success) error(422, 'Invalid fields. Check the required formats and limits.');
	return result.data;
}

export function privateJson(data: unknown, status = 200) {
	return json(data, {
		status,
		headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
	});
}
