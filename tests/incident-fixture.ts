import { expect, type APIRequestContext } from '@playwright/test';
import Database from 'better-sqlite3';
import { hashPassword } from 'better-auth/crypto';
import { signInWithRateLimit } from './auth-fixture';
import { enrollStaffMfa } from './mfa-fixture';

export const origin = 'http://127.0.0.1:4174';
export const headers = { Origin: origin };
export const password = 'test-password-123456';
export const privateMedical = 'PRIVATE-INCIDENT-ALLERGY';
export function database() {
	if (!process.env.HANDLINK_TEST_DB) throw new Error('An isolated test database is required.');
	const db = new Database(process.env.HANDLINK_TEST_DB);
	db.pragma('foreign_keys=ON');
	return db;
}
export async function provision(role = 'user') {
	const id = crypto.randomUUID();
	const profileId = crypto.randomUUID();
	const email = `${id}@example.com`;
	const hash = await hashPassword(password);
	const db = database();
	try {
		db.prepare(
			'INSERT INTO user (id,name,email,email_verified,role,updated_at) VALUES (?,?,?,?,?,?)'
		).run(id, 'Casey Reyes', email, 1, role, Date.now());
		db.prepare(
			'INSERT INTO account (id,account_id,provider_id,user_id,password,updated_at) VALUES (?,?,?,?,?,?)'
		).run(crypto.randomUUID(), id, 'credential', id, hash, Date.now());
		if (role === 'user') {
			db.prepare(
				'INSERT INTO user_profile (id,user_id,first_name,last_name,birthday,sex,phone,updated_at) VALUES (?,?,?,?,?,?,?,?)'
			).run(profileId, id, 'Casey', 'Reyes', '2000-01-01', 'Female', '+639171234567', Date.now());
			db.prepare('INSERT INTO medical_profile (profile_id,allergies) VALUES (?,?)').run(
				profileId,
				privateMedical
			);
			db.prepare(
				'INSERT INTO emergency_contact (id,profile_id,first_name,last_name,phone,email,relationship) VALUES (?,?,?,?,?,?,?)'
			).run(
				crypto.randomUUID(),
				profileId,
				'Robin',
				'Reyes',
				'+639181234567',
				'private-contact@example.com',
				'Sibling'
			);
		}
	} finally {
		db.close();
	}
	return { id, profileId, email, role };
}
export async function login(
	request: APIRequestContext,
	account: Awaited<ReturnType<typeof provision>>,
	mfa = true
) {
	const response = await signInWithRateLimit(request, account.email, password);
	expect(response.ok(), await response.text()).toBe(true);
	if (mfa && account.role !== 'user') await enrollStaffMfa(request, password);
}
export function sos(profileId: string) {
	return {
		personProfileId: profileId,
		latitude: 14.5995,
		longitude: 120.9842,
		locationLabel: '',
		idempotencyKey: crypto.randomUUID()
	};
}
