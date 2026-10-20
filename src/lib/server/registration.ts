import { and, eq, ne, sql } from 'drizzle-orm';
import { error } from '@sveltejs/kit';
import { db } from './db/index.ts';
import { profile, user } from './db/schema.ts';
import { canonicalPhone } from '#lib/phone.ts';

export function emailInUse(email: string) {
	return !!db
		.select({ id: user.id })
		.from(user)
		.where(sql`lower(${user.email}) = ${email.trim().toLowerCase()}`)
		.get();
}

export function phoneInUse(phone: string, exceptUserId = '') {
	// Compare legacy local/international values without rewriting existing records.
	const digits = sql`replace(replace(replace(replace(replace(${profile.phone}, '+', ''), ' ', ''), '-', ''), '(', ''), ')', '')`;
	const normalized = sql`case when ${digits} like '09%' then '63' || substr(${digits}, 2) else ${digits} end`;
	return !!db
		.select({ id: profile.id })
		.from(profile)
		.where(
			and(eq(normalized, canonicalPhone(phone).replace('+', '')), ne(profile.userId, exceptUserId))
		)
		.get();
}

// Call inside an immediate write transaction when saving a profile.
export function requireAvailablePhone(phone: string, exceptUserId = '') {
	if (phoneInUse(phone, exceptUserId))
		error(409, 'This phone number is already registered. Use another number.');
}
