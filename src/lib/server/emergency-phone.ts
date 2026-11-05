import { eq } from 'drizzle-orm';
import type { RequestEvent } from '@sveltejs/kit';
import { z } from 'zod';
import { DEFAULT_SOS_PHONE, SOS_PHONE_PATTERN } from '../emergency-phone.ts';
import { db } from './db/index.ts';
import { emergencyPhoneSetting } from './db/schema.ts';
import { requireCentralAdmin } from './api.ts';

export const emergencyPhoneInput = z.strictObject({
	number: z
		.string()
		.trim()
		.regex(
			SOS_PHONE_PATTERN,
			'Enter 3–15 digits with an optional leading +. Do not include spaces, extensions or symbols.'
		)
});

export function sosPhoneNumber() {
	return (
		db.select().from(emergencyPhoneSetting).where(eq(emergencyPhoneSetting.id, 'sos')).get()
			?.number ?? DEFAULT_SOS_PHONE
	);
}

export function adminEmergencyPhone(event: RequestEvent) {
	requireCentralAdmin(event);
	return { number: sosPhoneNumber() };
}

export function saveEmergencyPhone(event: RequestEvent, number: string) {
	return db.transaction(
		() => {
			const actor = requireCentralAdmin(event);
			const values = { number, updatedByUserId: actor.id, updatedAt: new Date() };
			db.insert(emergencyPhoneSetting)
				.values({ id: 'sos', ...values })
				.onConflictDoUpdate({ target: emergencyPhoneSetting.id, set: values })
				.run();
			return { number };
		},
		{ behavior: 'immediate' }
	);
}
