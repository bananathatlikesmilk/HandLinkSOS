import { expect, test, type APIRequestContext } from '@playwright/test';
import Database from 'better-sqlite3';
import { hashPassword } from 'better-auth/crypto';
import { signInWithRateLimit } from './auth-fixture';

const origin = 'http://127.0.0.1:4174';
const headers = { Origin: origin };
const input = {
	firstName: 'Casey',
	lastName: 'Reyes',
	birthday: '2000-01-01',
	sex: 'Female',
	phone: '+639171234567',
	medical: {
		bloodType: 'O+',
		chronicCondition: '',
		allergies: 'PRIVATE-MEDICAL',
		currentMedications: '',
		additionalInformation: ''
	},
	emergencyContacts: [
		{
			firstName: 'Robin',
			lastName: 'Reyes',
			phone: '+639171234567',
			email: 'robin@example.com',
			relationship: 'Sibling'
		}
	]
};

async function signIn(request: APIRequestContext) {
	const email = `${crypto.randomUUID()}@example.com`;
	const password = 'test-password-123456';
	// Isolated fixture: provision credentials without consuming registration rate limits.
	const id = crypto.randomUUID();
	const hash = await hashPassword(password);
	const client = new Database(process.env.HANDLINK_TEST_DB!);
	client
		.prepare('INSERT INTO user (id,name,email,email_verified,role,updated_at) VALUES (?,?,?,?,?,?)')
		.run(id, 'Test User', email, 1, 'user', Date.now());
	client
		.prepare(
			'INSERT INTO account (id,account_id,provider_id,user_id,password,updated_at) VALUES (?,?,?,?,?,?)'
		)
		.run(crypto.randomUUID(), id, 'credential', id, hash, Date.now());
	client.close();
	const login = await signInWithRateLimit(request, email, password);
	expect(login.ok()).toBe(true);
	return id;
}

test('profile persistence is owner-scoped and rejects privileged input', async ({
	request,
	playwright
}) => {
	const userId = await signIn(request);
	const saved = await request.put('/api/profile', { headers, data: input });
	expect(saved.status()).toBe(200);
	const read = await request.get('/api/profile');
	expect(read.headers()['cache-control']).toBe('no-store');
	expect((await read.json()).medical.allergies).toBe('PRIVATE-MEDICAL');
	expect(
		(
			await request.put('/api/profile', {
				headers,
				data: { ...input, userId: 'other', role: 'admin' }
			})
		).status()
	).toBe(422);
	const another = await playwright.request.newContext({ baseURL: origin });
	await signIn(another);
	expect(await (await another.get('/api/profile')).json()).toEqual({ profile: null });
	await another.dispose();
	const client = new Database(process.env.HANDLINK_TEST_DB!);
	client.prepare("UPDATE user SET role='admin' WHERE id=?").run(userId);
	expect((await request.get('/api/profile')).status()).toBe(403);
	client.prepare("UPDATE user SET role='user',email_verified=0 WHERE id=?").run(userId);
	expect((await request.get('/api/profile')).status()).toBe(403);
	client.prepare('UPDATE user SET email_verified=1 WHERE id=?').run(userId);
	expect((await request.put('/api/profile', { headers, data: input })).status()).toBe(200);
	const deactivated = await request.post('/api/account/deactivate', { headers, data: {} });
	expect(deactivated.status()).toBe(200);
	expect((await request.get('/api/profile')).status()).toBe(401);
	expect((await request.put('/api/profile', { headers, data: input })).status()).toBe(401);
	expect(client.prepare('SELECT banned FROM user WHERE id=?').get(userId).banned).toBe(1);
	expect(
		client.prepare('SELECT count(*) AS n FROM user_profile WHERE user_id=?').get(userId).n
	).toBe(1);
	client.close();
});

test('API rejects foreign origins, oversized bodies, and invalid fields', async ({ request }) => {
	await signIn(request);
	expect(
		(
			await request.put('/api/profile', {
				headers: { Origin: 'https://attacker.example' },
				data: input
			})
		).status()
	).toBe(403);
	expect(
		(
			await request.put('/api/profile', {
				headers,
				data: { ...input, firstName: 'a'.repeat(40000) }
			})
		).status()
	).toBe(413);
	expect(
		(
			await request.put('/api/profile', { headers, data: { ...input, birthday: '2001-02-29' } })
		).status()
	).toBe(422);
	expect(await (await request.get('/api/profile')).json()).toEqual({ profile: null });
});

test('public registration cannot grant a staff role', async ({ request }) => {
	const response = await request.post('/api/auth/sign-up/email', {
		headers,
		data: {
			email: crypto.randomUUID() + '@example.com',
			password: 'test-password-123456',
			name: 'Test User',
			role: 'admin'
		}
	});
	expect(response.status()).toBe(400);
	expect((await response.json()).code).toBe('FIELD_NOT_ALLOWED');
});
