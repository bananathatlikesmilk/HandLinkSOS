import { error, type RequestEvent } from '@sveltejs/kit';
import { and, count, eq, gte, isNull, ne } from 'drizzle-orm';
import type { z } from 'zod';
import { requireUser } from './api.ts';
import { db } from './db/index.ts';
import { device } from './db/schema.ts';
import { firebasePushConfigured } from './firebase-push.ts';
import type { deviceInput } from './validation.ts';

export function pushStatus(event: RequestEvent) {
	const { identity } = requireUser(event);
	return {
		configured: firebasePushConfigured(),
		enabled: Boolean(
			db
				.select({ id: device.id })
				.from(device)
				.where(
					and(
						eq(device.userId, identity.id),
						eq(device.sessionId, event.locals.session!.id),
						isNull(device.revokedAt)
					)
				)
				.get()
		)
	};
}

export function registerPushDevice(event: RequestEvent, input: z.output<typeof deviceInput>) {
	return db.transaction(
		(tx) => {
			const { identity } = requireUser(event);
			if (!firebasePushConfigured())
				error(503, 'Push delivery setup is not complete. In-app alerts remain available.');
			const sessionId = event.locals.session!.id;
			const existing = tx.select().from(device).where(eq(device.pushToken, input.pushToken)).get();
			const unchanged =
				existing?.userId === identity.id && existing.sessionId === sessionId && !existing.revokedAt;
			if (!unchanged) {
				const recent = tx
					.select({ n: count() })
					.from(device)
					.where(
						and(eq(device.userId, identity.id), gte(device.createdAt, new Date(Date.now() - 60000)))
					)
					.get()!.n;
				if (recent >= 20)
					error(429, 'Too many new device registrations. Wait a minute before retrying.');
			}
			const active = tx
				.select()
				.from(device)
				.where(and(eq(device.userId, identity.id), isNull(device.revokedAt)))
				.all();
			if (
				(!existing || existing.userId !== identity.id || existing.revokedAt) &&
				active.length >= 10
			)
				error(429, 'Too many registered devices. Disable notifications on an unused device first.');
			// Token rotation in this signed-in session disables its older token.
			tx.update(device)
				.set({ revokedAt: new Date() })
				.where(and(eq(device.sessionId, sessionId), ne(device.pushToken, input.pushToken)))
				.run();
			if (existing) {
				tx.update(device)
					.set({
						userId: identity.id,
						sessionId,
						revokedAt: null,
						...(unchanged ? {} : { createdAt: new Date() })
					})
					.where(eq(device.id, existing.id))
					.run();
			} else
				tx.insert(device)
					.values({ ...input, userId: identity.id, sessionId })
					.run();
			return { ok: true };
		},
		{ behavior: 'immediate' }
	);
}

export function revokePushDevice(event: RequestEvent, input: z.output<typeof deviceInput>) {
	const { identity } = requireUser(event);
	db.update(device)
		.set({ revokedAt: new Date() })
		.where(and(eq(device.userId, identity.id), eq(device.pushToken, input.pushToken)))
		.run();
	return { ok: true };
}
