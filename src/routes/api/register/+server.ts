import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { profile, medicalProfile, emergencyContact, user } from '#lib/server/db/schema.ts';
import { readInput, privateJson } from '#lib/server/api.ts';
import { profileInput } from '#lib/server/validation.ts';
import { emailConfigured } from '#lib/server/email.ts';
import { emailInUse, requireAvailablePhone } from '#lib/server/registration.ts';
import type { RequestHandler } from './$types';

const registrationInput = z.strictObject({
	email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
	password: z.string().min(12).max(128),
	profile: profileInput
});
export const POST: RequestHandler = async (event) => {
	const input = await readInput(event, registrationInput);
	if (emailInUse(input.email))
		error(409, 'This email is already registered. Log in or use another email.');
	requireAvailablePhone(input.profile.phone);
	if (!emailConfigured) error(503, 'Email setup is required before account creation.');
	// Reuse Better Auth's HTTP endpoint so registration rate limits and verification hooks still apply.
	const response = await event.fetch('/api/auth/sign-up/email', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Origin: event.url.origin },
		body: JSON.stringify({
			email: input.email,
			password: input.password,
			name: `${input.profile.firstName} ${input.profile.lastName}`
		})
	});
	if (!response.ok)
		error(
			response.status === 429 ? 429 : 400,
			'Account creation could not complete. Check your details or try again later.'
		);
	const result = await response.json();
	const identity =
		typeof result.user?.id === 'string'
			? db.select().from(user).where(eq(user.id, result.user.id)).get()
			: undefined;
	// Better Auth can return a synthetic user for an existing email. Never overwrite an existing profile.
	if (
		identity &&
		!identity.emailVerified &&
		identity.email.toLowerCase() === input.email.toLowerCase()
	) {
		try {
			db.transaction(
				(tx) => {
					if (tx.select().from(profile).where(eq(profile.userId, identity.id)).get())
						error(409, 'This email is already registered. Log in or use another email.');
					requireAvailablePhone(input.profile.phone, identity.id);
					const profileId = crypto.randomUUID();
					const { medical, emergencyContacts, ...personal } = input.profile;
					tx.insert(profile)
						.values({ id: profileId, userId: identity.id, ...personal, updatedAt: new Date() })
						.run();
					tx.insert(medicalProfile)
						.values({ profileId, ...medical })
						.run();
					for (const contact of emergencyContacts)
						tx.insert(emergencyContact)
							.values({ profileId, ...contact })
							.run();
				},
				{ behavior: 'immediate' }
			);
		} catch (cause) {
			// A concurrent registration can claim the phone during the async auth call.
			// Remove this newly created, unverified identity when its profile was not saved.
			db.transaction(
				(tx) => {
					if (
						!tx
							.select({ id: profile.id })
							.from(profile)
							.where(eq(profile.userId, identity.id))
							.get()
					)
						tx.delete(user).where(eq(user.id, identity.id)).run();
				},
				{ behavior: 'immediate' }
			);
			throw cause;
		}
	} else error(409, 'This email is already registered. Log in or use another email.');
	return privateJson({ ok: true });
};
