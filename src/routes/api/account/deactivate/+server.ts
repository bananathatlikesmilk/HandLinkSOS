import { eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import {
	profile,
	session,
	user,
	locationSession,
	locationRecipient
} from '#lib/server/db/schema.ts';
import { privateJson, readInput, requireUser } from '#lib/server/api.ts';
import { z } from 'zod';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	requireUser(event);
	await readInput(event, z.strictObject({}));
	db.transaction(
		(tx) => {
			const { identity, ownProfile } = requireUser(event);
			const now = new Date();
			if (ownProfile) {
				tx.update(profile)
					.set({ deactivatedAt: now, updatedAt: now })
					.where(eq(profile.id, ownProfile.id))
					.run();
				tx.update(locationSession)
					.set({ cancelledAt: now })
					.where(eq(locationSession.ownerProfileId, ownProfile.id))
					.run();
			}
			tx.update(user)
				.set({ banned: true, banReason: 'Account deactivated', updatedAt: now })
				.where(eq(user.id, identity.id))
				.run();
			tx.delete(session).where(eq(session.userId, identity.id)).run();
			tx.update(locationRecipient)
				.set({ revokedAt: now })
				.where(eq(locationRecipient.userId, identity.id))
				.run();
		},
		{ behavior: 'immediate' }
	);
	return privateJson({ ok: true });
};
