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

test('invalid input returns named fields and correction rules without submitted private values', async ({
	request
}) => {
	await signIn(request);
	const response = await request.put('/api/profile', {
		headers,
		data: {
			...input,
			firstName: ' ',
			phone: 'PRIVATE-BAD-PHONE',
			emergencyContacts: [{ ...input.emergencyContacts[0], email: 'PRIVATE-BAD-EMAIL' }]
		}
	});
	expect(response.status()).toBe(422);
	expect(response.headers()['cache-control']).toBe('no-store');
	const body = await response.json();
	expect(body.message).toContain('First name: This field is required.');
	expect(body.message).toContain('Phone number: Use 11 digits starting with 09');
	expect(body.message).toContain('Emergency contact 1 - Email: Enter a valid email');
	expect(body.issues).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ field: 'First name' }),
			expect.objectContaining({ field: 'Emergency contact 1 - Email' })
		])
	);
	expect(JSON.stringify(body)).not.toContain('PRIVATE');
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

test('registration detects used email and equivalent phone formats without exposing account details', async ({
	request
}) => {
	const id = await signIn(request);
	const data = { ...input, phone: '09812345678' };
	expect((await request.put('/api/profile', { headers, data })).status()).toBe(200);
	const client = new Database(process.env.HANDLINK_TEST_DB!);
	const identity = client.prepare('SELECT email FROM user WHERE id=?').get(id) as { email: string };
	client.close();
	for (const body of [
		{ email: identity.email.toUpperCase() },
		{ phone: '09812345678' },
		{ phone: '+639812345678' }
	]) {
		const result = await request.post('/api/register/availability', { headers, data: body });
		expect(result.status()).toBe(200);
		expect(result.headers()['cache-control']).toBe('no-store');
		expect(await result.json()).toEqual({ available: false });
	}
	const unused = await request.post('/api/register/availability', {
		headers,
		data: { email: `${crypto.randomUUID()}@example.com` }
	});
	expect(await unused.json()).toEqual({ available: true });
	expect(
		(
			await request.post('/api/register/availability', {
				headers: { Origin: 'https://attacker.example' },
				data: { phone: data.phone }
			})
		).status()
	).toBe(403);
	for (const phone of ['0981234567', '098123456789', '+12025550123', '09a812345678']) {
		expect(
			(await request.post('/api/register/availability', { headers, data: { phone } })).status()
		).toBe(422);
	}
	for (const registration of [
		{ email: identity.email.toUpperCase(), password: 'test-password-123456', profile: data },
		{ email: `${crypto.randomUUID()}@example.com`, password: 'test-password-123456', profile: data }
	]) {
		expect((await request.post('/api/register', { headers, data: registration })).status()).toBe(
			409
		);
	}
});

test('profile phone uniqueness survives concurrent saves and preserves emergency contact sharing', async ({
	request,
	playwright
}) => {
	await signIn(request);
	const another = await playwright.request.newContext({ baseURL: origin });
	await signIn(another);
	const data = { ...input, phone: '09912345678' };
	const results = await Promise.all([
		request.put('/api/profile', { headers, data }),
		another.put('/api/profile', { headers, data: { ...data, phone: '+639912345678' } })
	]);
	expect(results.map((result) => result.status()).sort()).toEqual([200, 409]);
	const winner = results[0].ok() ? request : another;
	expect((await winner.put('/api/profile', { headers, data })).status()).toBe(200);
	const saved = await (await winner.get('/api/profile')).json();
	expect(saved.profile.phone).toBe('+639912345678');
	expect(saved.emergencyContacts[0].phone).toBe(input.emergencyContacts[0].phone);
	await another.dispose();
});
