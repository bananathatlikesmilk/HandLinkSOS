import { emptyProfile, type EmergencyContact, type UserProfile } from './preview.svelte.ts';
import { apiFetch, readApiResponse } from '#lib/client/request.ts';

type ProfileResponse = {
	profile: Pick<UserProfile, 'id' | 'firstName' | 'lastName' | 'birthday' | 'sex' | 'phone'> | null;
	medical?: Partial<
		Pick<
			UserProfile,
			'chronicCondition' | 'allergies' | 'currentMedications' | 'additionalInformation'
		>
	> & { bloodType: string | null };
	emergencyContacts?: EmergencyContact[];
};

export function profileFromResponse(data: ProfileResponse, email: string): UserProfile {
	return {
		...emptyProfile(),
		...data.profile,
		...data.medical,
		bloodType: data.medical?.bloodType === 'Unknown' ? '' : (data.medical?.bloodType ?? ''),
		email,
		contacts: data.emergencyContacts?.length
			? data.emergencyContacts
			: [{ id: 'new-contact', firstName: '', lastName: '', phone: '', email: '', relationship: '' }]
	};
}

function internationalPhone(value: string) {
	const cleaned = value.trim().replace(/[\s()-]/g, '');
	return /^09\d{9}$/.test(cleaned) ? `+63${cleaned.slice(1)}` : cleaned;
}

export function profilePayload(profile: UserProfile) {
	return {
		firstName: profile.firstName,
		lastName: profile.lastName,
		birthday: profile.birthday,
		sex: profile.sex,
		phone: internationalPhone(profile.phone),
		medical: {
			bloodType: profile.bloodType || null,
			chronicCondition: profile.chronicCondition,
			allergies: profile.allergies,
			currentMedications: profile.currentMedications,
			additionalInformation: profile.additionalInformation
		},
		emergencyContacts: profile.contacts.map((contact) => ({
			firstName: contact.firstName,
			lastName: contact.lastName,
			phone: internationalPhone(contact.phone),
			email: contact.email,
			relationship: contact.relationship
		}))
	};
}

export async function accountRequest(path: string, body: unknown = {}, method = 'POST') {
	const response = await apiFetch(path, {
		method,
		credentials: 'same-origin',
		cache: 'no-store',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	});
	if (!response.ok) await readApiResponse(response);
	return response;
}

export async function loadAccountProfile(email: string): Promise<UserProfile> {
	const response = await fetch('/api/profile', { credentials: 'same-origin', cache: 'no-store' });
	if (!response.ok)
		throw new Error(
			'Your changes were saved, but the profile could not be refreshed. Please reload.'
		);
	return profileFromResponse(await response.json(), email);
}
