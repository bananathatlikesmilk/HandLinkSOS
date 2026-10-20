import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { privateJson, readInput } from '#lib/server/api.ts';
import { emailInUse, phoneInUse } from '#lib/server/registration.ts';
import { phoneInput } from '#lib/server/validation.ts';
import type { RequestHandler } from './$types';

const input = z.union([
	z.strictObject({ email: z.string().trim().toLowerCase().pipe(z.email().max(254)) }),
	z.strictObject({ phone: phoneInput })
]);
const attempts = new Map<string, { count: number; until: number }>();

export const POST: RequestHandler = async (event) => {
	const value = await readInput(event, input);
	let address = 'shared';
	try {
		address = event.getClientAddress();
	} catch {
		/* Preview has no client address. */
	}
	const now = Date.now();
	for (const [key, entry] of attempts) if (entry.until <= now) attempts.delete(key);
	const entry = attempts.get(address) ?? { count: 0, until: now + 60000 };
	if (entry.count >= 30 || (!attempts.has(address) && attempts.size >= 5000))
		error(429, 'Too many checks. Wait a minute and try again.');
	entry.count++;
	attempts.set(address, entry);
	return privateJson({
		available: 'email' in value ? !emailInUse(value.email) : !phoneInUse(value.phone)
	});
};
