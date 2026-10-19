import { error, redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { emergencyContact, medicalProfile, profile } from '#lib/server/db/schema.ts';
import { portalAccount } from '#lib/server/portal.ts';
import { emailConfigured } from '#lib/server/email.ts';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = (event) => {
	const publicRoutes = [
		'/user',
		'/user/',
		'/user/login',
		'/user/register',
		'/user/verify',
		'/user/forgot-password',
		'/user/reset-password'
	];
	const account = portalAccount(event, 'user', !publicRoutes.includes(event.url.pathname));
	if (!account) return { account: null, accountProfile: null, emailConfigured };
	const saved = db.select().from(profile).where(eq(profile.userId, account.id)).get();
	if (saved?.deactivatedAt) error(403, 'Account is deactivated.');
	if (['/user', '/user/', '/user/login'].includes(event.url.pathname))
		redirect(303, resolve('/user/dashboard'));
	const medical = saved
		? db.select().from(medicalProfile).where(eq(medicalProfile.profileId, saved.id)).get()
		: undefined;
	const contacts = saved
		? db.select().from(emergencyContact).where(eq(emergencyContact.profileId, saved.id)).all()
		: [];
	return {
		account,
		emailConfigured,
		accountProfile: {
			id: saved?.id ?? '',
			firstName: saved?.firstName ?? account.name,
			lastName: saved?.lastName ?? '',
			birthday: saved?.birthday ?? '',
			sex: saved?.sex ?? '',
			phone: saved?.phone ?? '',
			email: account.email,
			bloodType: medical?.bloodType ?? '',
			chronicCondition: medical?.chronicCondition ?? '',
			allergies: medical?.allergies ?? '',
			currentMedications: medical?.currentMedications ?? '',
			additionalInformation: medical?.additionalInformation ?? '',
			contacts: contacts.length
				? contacts.map(({ id, firstName, lastName, phone, email, relationship }) => ({
						id,
						firstName,
						lastName,
						phone,
						email,
						relationship
					}))
				: [{ id: '', firstName: '', lastName: '', phone: '', email: '', relationship: '' }]
		}
	};
};
