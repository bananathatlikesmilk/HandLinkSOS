import { eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { emergencyContact, medicalProfile, profile, user } from '#lib/server/db/schema.ts';
import { privateJson, readInput, requireUser } from '#lib/server/api.ts';
import { profileInput } from '#lib/server/validation.ts';
import { revokeInvalidLocationRecipients } from '#lib/server/location-policy.ts';
import { requireAvailablePhone } from '#lib/server/registration.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) => {
	const { ownProfile } = requireUser(event);
	if (!ownProfile) return privateJson({ profile: null });
	const medical = db
		.select()
		.from(medicalProfile)
		.where(eq(medicalProfile.profileId, ownProfile.id))
		.get();
	const contacts = db
		.select({
			id: emergencyContact.id,
			firstName: emergencyContact.firstName,
			lastName: emergencyContact.lastName,
			phone: emergencyContact.phone,
			email: emergencyContact.email,
			relationship: emergencyContact.relationship
		})
		.from(emergencyContact)
		.where(eq(emergencyContact.profileId, ownProfile.id))
		.all();
	return privateJson({ profile: ownProfile, medical, emergencyContacts: contacts });
};

export const PUT: RequestHandler = async (event) => {
	requireUser(event);
	const input = await readInput(event, profileInput);
	const saved = db.transaction(
		(tx) => {
			// Recheck after the async body read, while the write transaction holds its lock.
			const { identity } = requireUser(event);
			requireAvailablePhone(input.phone, identity.id);
			const existing = tx.select().from(profile).where(eq(profile.userId, identity.id)).get();
			const profileId = existing?.id ?? crypto.randomUUID();
			const { medical, emergencyContacts, ...personal } = input;
			const now = new Date();
			if (existing) {
				tx.update(profile)
					.set({ ...personal, updatedAt: now })
					.where(eq(profile.id, profileId))
					.run();
			} else {
				tx.insert(profile)
					.values({ ...personal, id: profileId, userId: identity.id, updatedAt: now })
					.run();
			}
			tx.insert(medicalProfile)
				.values({ profileId, ...medical })
				.onConflictDoUpdate({ target: medicalProfile.profileId, set: medical })
				.run();
			// A linked app account is privileged information; clients cannot assign it.
			// Editing contact details removes links until the recipient is verified again.
			tx.delete(emergencyContact).where(eq(emergencyContact.profileId, profileId)).run();
			for (const contact of emergencyContacts)
				tx.insert(emergencyContact)
					.values({ ...contact, profileId })
					.run();
			tx.update(user)
				.set({ name: `${personal.firstName} ${personal.lastName}`, updatedAt: now })
				.where(eq(user.id, identity.id))
				.run();
			revokeInvalidLocationRecipients(tx, profileId);
			return profileId;
		},
		{ behavior: 'immediate' }
	);
	return privateJson({ profileId: saved });
};
