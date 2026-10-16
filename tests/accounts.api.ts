import { expect, test, type APIRequestContext } from '@playwright/test';
import Database from 'better-sqlite3';
import { hashPassword } from 'better-auth/crypto';
import { signInWithRateLimit } from './auth-fixture';
import { enrollStaffMfa } from './mfa-fixture';

const headers = { Origin: 'http://127.0.0.1:4174' };
const password = 'test-password-123456';

async function identity(role = 'admin') {
	const id = crypto.randomUUID();
	const email = `${id}@example.com`;
	const client = new Database(process.env.HANDLINK_TEST_DB!);
	try {
		client
			.prepare(
				'INSERT INTO user (id,name,email,email_verified,role,updated_at) VALUES (?,?,?,?,?,?)'
			)
			.run(id, 'Test Account', email, 1, role, Date.now());
		client
			.prepare(
				'INSERT INTO account (id,account_id,provider_id,user_id,password,updated_at) VALUES (?,?,?,?,?,?)'
			)
			.run(crypto.randomUUID(), id, 'credential', id, await hashPassword(password), Date.now());
	} finally {
		client.close();
	}
	return { id, email };
}

async function login(request: APIRequestContext, email: string) {
	const response = await signInWithRateLimit(request, email, password);
	expect(response.ok(), await response.text()).toBe(true);
	await enrollStaffMfa(request, password);
}

for (const role of ['dispatcher', 'admin'] as const) {
	const label = role === 'admin' ? 'Admin' : 'Dispatcher';
	test(`admin manages a saved ${role} through the website on a phone-sized screen`, async ({
		page
	}) => {
		const actor = await identity();
		await login(page.request, actor.email);
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto('/admin/accounts');
		await page.waitForLoadState('networkidle');
		await expect(page.getByRole('heading', { name: /Manage accounts/ })).toBeVisible();
		await page.getByRole('button', { name: 'Create staff account', exact: true }).click();
		const dialog = page.getByRole('dialog', { name: 'Create staff account', exact: true });
		const email = `${crypto.randomUUID()}@example.com`;
		await dialog.getByRole('combobox', { name: 'Account role', exact: true }).selectOption(role);
		await dialog.getByLabel('Full name', { exact: true }).fill(`UI ${label}`);
		await dialog.getByLabel('Email address', { exact: true }).fill(email);
		await dialog.getByLabel('Initial password', { exact: true }).fill(password);
		await dialog.getByRole('button', { name: 'Create staff account', exact: true }).click();
		const saved = page.getByRole('dialog', { name: `${label} account saved`, exact: true });
		await expect(saved).toBeVisible();
		await expect(
			saved.getByRole('button', { name: 'Send verification code', exact: true })
		).toBeDisabled();
		await saved.getByRole('button', { name: 'Done', exact: true }).click();
		await page.getByRole('textbox', { name: 'Search accounts' }).fill(email);
		await page.getByRole('button', { name: 'Search', exact: true }).click();
		await expect(page.getByRole('row').filter({ hasText: email })).toBeVisible();
		await page.reload();
		const row = page.getByRole('row').filter({ hasText: email });
		await expect(row.getByText('Unverified', { exact: true })).toBeVisible();
		await page.waitForLoadState('networkidle');
		await row.getByRole('button', { name: `Deactivate ${email}`, exact: true }).click();
		await page
			.getByRole('dialog', { name: 'Deactivate account?', exact: true })
			.getByRole('button', { name: 'Deactivate account', exact: true })
			.click();
		await expect(row.getByText('Inactive', { exact: true })).toBeVisible();
		await row.getByRole('button', { name: `Reactivate ${email}`, exact: true }).click();
		await page
			.getByRole('dialog', { name: 'Reactivate account?', exact: true })
			.getByRole('button', { name: 'Reactivate account', exact: true })
			.click();
		await expect(row.getByText('Active', { exact: true })).toBeVisible();
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
			true
		);
	});
}

test('account APIs enforce admin access, current identity, CSRF, and closed auth admin endpoints', async ({
	request
}) => {
	expect((await request.get('/api/admin/accounts')).status()).toBe(401);
	const actor = await identity();
	await login(request, actor.email);
	const client = new Database(process.env.HANDLINK_TEST_DB!);
	try {
		for (const role of ['user', 'dispatcher']) {
			client.prepare('UPDATE user SET role=? WHERE id=?').run(role, actor.id);
			expect((await request.get('/api/admin/accounts')).status()).toBe(403);
			expect((await request.post('/api/admin/accounts', { headers, data: {} })).status()).toBe(403);
		}
		client.prepare("UPDATE user SET role='admin' WHERE id=?").run(actor.id);
		expect((await request.get('/api/admin/accounts')).headers()['cache-control']).toBe('no-store');
		expect(
			(
				await request.post('/api/admin/accounts', {
					headers: { Origin: 'https://attacker.example' },
					data: {}
				})
			).status()
		).toBe(403);
		expect(
			(
				await request.post('/api/admin/accounts', { headers, data: { name: 'a'.repeat(40000) } })
			).status()
		).toBe(413);
		for (const path of [
			'set-role',
			'create-user',
			'update-user',
			'ban-user',
			'remove-user',
			'impersonate-user'
		]) {
			expect(
				(
					await request.post(`/api/auth/admin/${path}`, {
						headers,
						data: { userId: actor.id, role: 'admin' }
					})
				).status()
			).toBe(404);
		}
		expect((await request.get('/api/auth/admin/list-users')).status()).toBe(404);
		client.prepare('UPDATE user SET email_verified=0 WHERE id=?').run(actor.id);
		expect((await request.get('/api/admin/accounts')).status()).toBe(403);
		client.prepare('UPDATE user SET email_verified=1,banned=1 WHERE id=?').run(actor.id);
		expect([401, 403]).toContain((await request.get('/api/admin/accounts')).status());
	} finally {
		client.close();
	}
});

test('dispatcher creation validates fields, rejects concurrent duplicates, and returns only safe account fields', async ({
	request
}) => {
	const actor = await identity();
	await login(request, actor.email);
	const email = `${crypto.randomUUID()}@example.com`;
	const input = { name: 'New Dispatcher', email: email.toUpperCase(), password };
	for (const invalid of [
		{ ...input, role: 'superadmin' },
		{ ...input, role: 'user' },
		{ ...input, emailVerified: true },
		{ ...input, password: 'short' },
		{ ...input, email: 'invalid' },
		{ ...input, name: ' ' }
	]) {
		expect((await request.post('/api/admin/accounts', { headers, data: invalid })).status()).toBe(
			422
		);
	}
	const results = await Promise.all(
		[0, 1].map(() => request.post('/api/admin/accounts', { headers, data: input }))
	);
	expect(results.map((r) => r.status()).sort()).toEqual([201, 409]);
	const created = (await results.find((r) => r.status() === 201)!.json()).account;
	expect(created).toMatchObject({ email, role: 'dispatcher', emailVerified: false, active: true });
	expect(Object.keys(created).sort()).toEqual([
		'active',
		'createdAt',
		'email',
		'emailVerified',
		'id',
		'name',
		'role'
	]);
	const listed = await (
		await request.get(`/api/admin/accounts?search=${email}&role=dispatcher`)
	).json();
	expect(listed.accounts).toHaveLength(1);
	expect(listed.accounts[0].id).toBe(created.id);
	expect((await request.get('/api/admin/accounts?page=0')).status()).toBe(422);
	expect((await request.get('/api/admin/accounts?role=superadmin')).status()).toBe(422);
	expect((await (await request.get('/api/admin/accounts?search=%25')).json()).total).toBe(0);
	const denied = await signInWithRateLimit(request, email, password);
	expect(denied.status()).toBe(403);
	expect((await denied.json()).code).toBe('EMAIL_NOT_VERIFIED');
	expect(
		(
			await request.post(`/api/admin/accounts/${created.id}/verification`, { headers, data: {} })
		).status()
	).toBe(503);
	const client = new Database(process.env.HANDLINK_TEST_DB!);
	try {
		expect(
			client.prepare('SELECT email_verified FROM user WHERE id=?').get(created.id)
		).toMatchObject({ email_verified: 0 });
		expect(
			client.prepare('SELECT action FROM account_audit WHERE target_user_id=?').get(created.id)
		).toMatchObject({ action: 'dispatcher_created' });
		// Failure of the audit write must roll back both identity and credential inserts.
		client.exec(
			"CREATE TRIGGER fail_account_audit BEFORE INSERT ON account_audit BEGIN SELECT RAISE(ABORT,'test rollback'); END"
		);
		try {
			const rollbackEmail = `${crypto.randomUUID()}@example.com`;
			expect(
				(
					await request.post('/api/admin/accounts', {
						headers,
						data: { ...input, email: rollbackEmail }
					})
				).status()
			).toBe(500);
			expect(
				client.prepare('SELECT count(*) AS n FROM user WHERE email=?').get(rollbackEmail)
			).toMatchObject({ n: 0 });
		} finally {
			client.exec('DROP TRIGGER fail_account_audit');
		}
	} finally {
		client.close();
	}
});

test('admin creation requires verification and MFA, audits the role, and shares the staff creation quota', async ({
	request,
	playwright
}) => {
	test.setTimeout(90000);
	const actor = await identity();
	await login(request, actor.email);
	const email = `${crypto.randomUUID()}@example.com`;
	const response = await request.post('/api/admin/accounts', {
		headers,
		data: { name: 'Additional Admin', email, password, role: 'admin' }
	});
	expect(response.status()).toBe(201);
	const created = (await response.json()).account;
	expect(created).toMatchObject({ role: 'admin', emailVerified: false, active: true });
	const other = await playwright.request.newContext({ baseURL: headers.Origin });
	const client = new Database(process.env.HANDLINK_TEST_DB!);
	try {
		expect((await signInWithRateLimit(other, email, password)).status()).toBe(403);
		expect(
			client.prepare('SELECT action FROM account_audit WHERE target_user_id=?').get(created.id)
		).toMatchObject({ action: 'admin_created' });
		// Only this isolated fixture bypasses email delivery; production must verify through OTP.
		client.prepare('UPDATE user SET email_verified=1 WHERE id=?').run(created.id);
		expect((await signInWithRateLimit(other, email, password)).ok()).toBe(true);
		expect(
			(
				await other.post('/api/admin/accounts', {
					headers,
					data: { name: 'Denied', email: `denied-${email}`, password, role: 'admin' }
				})
			).status()
		).toBe(403);
		await enrollStaffMfa(other, password);
		expect((await other.get('/api/admin/accounts')).status()).toBe(200);
		const insert = client.prepare(
			'INSERT INTO account_audit (id,actor_user_id,target_user_id,action) VALUES (?,?,?,?)'
		);
		for (let i = 0; i < 19; i++)
			insert.run(
				crypto.randomUUID(),
				actor.id,
				created.id,
				i % 2 ? 'dispatcher_created' : 'admin_created'
			);
		expect(
			(
				await request.post('/api/admin/accounts', {
					headers,
					data: { name: 'Over quota', email: `quota-${email}`, password, role: 'admin' }
				})
			).status()
		).toBe(429);
		expect(
			(
				await request.post('/api/admin/accounts', {
					headers,
					data: { name: 'Over quota', email: `quota-${email}`, password, role: 'dispatcher' }
				})
			).status()
		).toBe(429);
	} finally {
		client.close();
		await other.dispose();
	}
});

test('last admin stays active and concurrent admin deactivations cannot remove both moderators', async ({
	request,
	playwright
}) => {
	test.setTimeout(90000);
	const actor = await identity();
	const second = await identity();
	await login(request, actor.email);
	const other = await playwright.request.newContext({ baseURL: headers.Origin });
	await login(other, second.email);
	const client = new Database(process.env.HANDLINK_TEST_DB!);
	const original = client
		.prepare("SELECT id,banned FROM user WHERE role='admin' AND id NOT IN (?,?)")
		.all(actor.id, second.id);
	try {
		// Make the invariant independent of other fixtures in this shared, isolated database.
		client.prepare("UPDATE user SET banned=1 WHERE role='admin' AND id<>?").run(actor.id);
		const pending = await request.post('/api/admin/accounts', {
			headers,
			data: {
				name: 'Pending Admin',
				email: `${crypto.randomUUID()}@example.com`,
				password,
				role: 'admin'
			}
		});
		expect(pending.status()).toBe(201);
		const blocked = await request.patch(`/api/admin/accounts/${actor.id}`, {
			headers,
			data: { active: false }
		});
		expect(blocked.status()).toBe(409);
		expect(await blocked.text()).toContain('last active administrator');
		expect((await request.post('/api/account/deactivate', { headers, data: {} })).status()).toBe(
			403
		);
		expect((await request.delete(`/api/admin/accounts/${actor.id}`, { headers })).status()).toBe(
			405
		);
		client.prepare('UPDATE user SET banned=0 WHERE id=?').run(second.id);
		const results = await Promise.all([
			request.patch(`/api/admin/accounts/${second.id}`, { headers, data: { active: false } }),
			other.patch(`/api/admin/accounts/${actor.id}`, { headers, data: { active: false } })
		]);
		expect(results.filter((r) => r.status() === 200)).toHaveLength(1);
		expect(results.filter((r) => [401, 403].includes(r.status()))).toHaveLength(1);
		expect(
			client.prepare('SELECT count(*) AS n FROM user WHERE id IN (?,?)').get(actor.id, second.id)
		).toMatchObject({ n: 2 });
		expect(
			client
				.prepare('SELECT count(*) AS n FROM user WHERE id IN (?,?) AND coalesce(banned,0)=0')
				.get(actor.id, second.id)
		).toMatchObject({ n: 1 });
	} finally {
		for (const row of original)
			client.prepare('UPDATE user SET banned=? WHERE id=?').run(row.banned, row.id);
		client.close();
		await other.dispose();
	}
});

test('deactivation revokes sessions, retains records, synchronizes profiles, and reactivation requires a fresh login', async ({
	request,
	playwright
}) => {
	const actor = await identity();
	const target = await identity('user');
	await login(request, actor.email);
	const other = await playwright.request.newContext({ baseURL: headers.Origin });
	await login(other, target.email);
	const client = new Database(process.env.HANDLINK_TEST_DB!);
	const profileId = crypto.randomUUID();
	try {
		client
			.prepare(
				'INSERT INTO user_profile (id,user_id,first_name,last_name,birthday,sex,phone,updated_at) VALUES (?,?,?,?,?,?,?,?)'
			)
			.run(
				profileId,
				target.id,
				'Casey',
				'Reyes',
				'2000-01-01',
				'Female',
				'+639171234567',
				Date.now()
			);
		client
			.prepare('INSERT INTO medical_profile (profile_id,allergies) VALUES (?,?)')
			.run(profileId, 'PRIVATE-TEST');
		client
			.prepare(
				'INSERT INTO location_session (id,owner_profile_id,created_at,expires_at) VALUES (?,?,?,?)'
			)
			.run(crypto.randomUUID(), profileId, Date.now(), Date.now() + 60000);
		expect(
			(
				await request.patch(`/api/admin/accounts/${actor.id}`, { headers, data: { active: false } })
			).status()
		).toBe(409);
		expect(
			(
				await request.patch(`/api/admin/accounts/${target.id}`, {
					headers,
					data: { active: false, role: 'admin' }
				})
			).status()
		).toBe(422);
		expect(
			(
				await request.patch(`/api/admin/accounts/${target.id}`, {
					headers,
					data: { active: 'false' }
				})
			).status()
		).toBe(422);
		expect(
			(
				await request.patch('/api/admin/accounts/missing', { headers, data: { active: false } })
			).status()
		).toBe(404);
		expect(
			(
				await request.patch(`/api/admin/accounts/${target.id}`, {
					headers,
					data: { active: false }
				})
			).status()
		).toBe(200);
		expect((await other.get('/api/profile')).status()).toBe(401);
		expect(
			client.prepare('SELECT count(*) AS n FROM session WHERE user_id=?').get(target.id)
		).toMatchObject({ n: 0 });
		expect(
			client.prepare('SELECT deactivated_at FROM user_profile WHERE id=?').get(profileId)
				.deactivated_at
		).not.toBeNull();
		expect(
			client
				.prepare('SELECT cancelled_at FROM location_session WHERE owner_profile_id=?')
				.get(profileId).cancelled_at
		).not.toBeNull();
		expect(
			client.prepare('SELECT allergies FROM medical_profile WHERE profile_id=?').get(profileId)
		).toMatchObject({ allergies: 'PRIVATE-TEST' });
		const list = await (await request.get(`/api/admin/accounts?search=${target.email}`)).text();
		expect(list).not.toContain('PRIVATE-TEST');
		expect(list).not.toContain('password');
		expect((await signInWithRateLimit(other, target.email, password)).status()).toBe(403);
		expect(
			(
				await request.patch(`/api/admin/accounts/${target.id}`, { headers, data: { active: true } })
			).status()
		).toBe(200);
		expect((await other.get('/api/profile')).status()).toBe(401);
		await login(other, target.email);
		expect((await other.get('/api/profile')).status()).toBe(200);
		expect(
			client.prepare('SELECT deactivated_at FROM user_profile WHERE id=?').get(profileId)
				.deactivated_at
		).toBeNull();
		expect(
			client
				.prepare('SELECT action FROM account_audit WHERE target_user_id=? ORDER BY created_at')
				.all(target.id)
				.map((r) => r.action)
		).toEqual(['deactivated', 'reactivated']);
	} finally {
		client.close();
		await other.dispose();
	}
});
