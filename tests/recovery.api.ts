import { expect, test } from '@playwright/test';
import Database from 'better-sqlite3';
import { createHmac, randomInt, randomUUID } from 'node:crypto';
import { hashPassword, verifyPassword } from 'better-auth/crypto';

const origin = 'http://127.0.0.1:4174';
const headers = { Origin: origin };
const secret = 'isolated-test-secret-only-012345678901234567890123456789';
const oldPassword = 'old-test-password-1234';
const newPassword = 'new-test-password-5678';

async function identity(role = 'user') {
	const id = randomUUID();
	const email = `${id}@example.com`;
	const client = new Database(process.env.HANDLINK_TEST_DB!);
	try {
		client
			.prepare(
				'INSERT INTO user (id,name,email,email_verified,role,updated_at) VALUES (?,?,?,?,?,?)'
			)
			.run(id, 'Recovery Test', email, 1, role, Date.now());
		client
			.prepare(
				'INSERT INTO account (id,account_id,provider_id,user_id,password,updated_at) VALUES (?,?,?,?,?,?)'
			)
			.run(randomUUID(), id, 'credential', id, await hashPassword(oldPassword), Date.now());
	} finally {
		client.close();
	}
	return { id, email };
}

function seedCode(
	email: string,
	options: {
		expired?: boolean;
		attempts?: number;
		purpose?: 'forget-password' | 'email-verification';
	} = {}
) {
	const code = String(randomInt(100000, 1000000));
	const client = new Database(process.env.HANDLINK_TEST_DB!);
	try {
		const identifier = `${options.purpose ?? 'forget-password'}-otp-${email}`;
		client.prepare('DELETE FROM verification WHERE identifier=?').run(identifier);
		const hash = createHmac('sha256', secret).update(code).digest('hex');
		client
			.prepare(
				'INSERT INTO verification (id,identifier,value,expires_at,created_at,updated_at) VALUES (?,?,?,?,?,?)'
			)
			.run(
				randomUUID(),
				identifier,
				`${hash}:${options.attempts ?? 0}`,
				Date.now() + (options.expired ? -1000 : 300000),
				Date.now(),
				Date.now()
			);
	} finally {
		client.close();
	}
	return code;
}

for (const portal of ['user', 'admin', 'dispatch'] as const) {
	test(`${portal} login links to email verification and returns to universal login`, async ({
		page
	}) => {
		test.setTimeout(60000);
		const actor = await identity(portal === 'dispatch' ? 'dispatcher' : portal);
		const client = new Database(process.env.HANDLINK_TEST_DB!);
		try {
			client.prepare('UPDATE user SET email_verified=0 WHERE id=?').run(actor.id);
			let code = '';
			let sendCount = 0;
			await page.route('**/api/auth/email-otp/send-verification-otp', async (route) => {
				expect(route.request().postDataJSON()).toEqual({
					email: actor.email,
					type: 'email-verification'
				});
				sendCount++;
				code = seedCode(actor.email, { purpose: 'email-verification' });
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: '{"success":true}'
				});
			});
			await page.setViewportSize({ width: 390, height: 844 });
			await page.goto(`/${portal}/login`);
			await expect(page).toHaveURL('/login');
			await page.waitForLoadState('networkidle');
			await page.getByRole('textbox', { name: 'Email', exact: true }).fill(actor.email);
			await page.getByRole('link', { name: 'Verify email', exact: true }).click();
			await expect(
				page.getByRole('heading', { name: 'Verify your email', exact: true })
			).toBeVisible();
			await expect(page.getByRole('textbox', { name: 'Email', exact: true })).toHaveValue(
				actor.email
			);
			await expect(
				page.getByRole('link', { name: 'Back to sign in', exact: true })
			).toHaveAttribute('href', '/login');
			expect(sendCount).toBe(0);
			await page.getByRole('button', { name: 'Send verification code', exact: true }).click();
			await expect(page.getByRole('status')).toContainText('new code');
			expect(sendCount).toBe(1);
			await page.getByLabel('6-digit verification code', { exact: true }).fill(code);
			await page.getByRole('button', { name: 'Verify email', exact: true }).click();
			await expect(page).toHaveURL('/login');
			expect(
				client.prepare('SELECT email_verified FROM user WHERE id=?').get(actor.id)
			).toMatchObject({ email_verified: 1 });
			expect(
				client.prepare('SELECT count(*) AS n FROM session WHERE user_id=?').get(actor.id)
			).toMatchObject({ n: 0 });
			expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
				true
			);
		} finally {
			client.close();
		}
	});
}

test('verification ignores unsupported return destinations', async ({ page }) => {
	await page.goto('/user/verify?portal=https%3A%2F%2Fattacker.example');
	await expect(page.getByRole('link', { name: 'Back to sign in', exact: true })).toHaveAttribute(
		'href',
		'/login'
	);
});

test('reset revokes all sessions, consumes its code, and accepts only the new password', async ({
	request
}) => {
	const actor = await identity();
	const login = await request.post('/api/auth/sign-in/email', {
		headers,
		data: { email: actor.email, password: oldPassword }
	});
	expect(login.ok()).toBe(true);
	const client = new Database(process.env.HANDLINK_TEST_DB!);
	try {
		client
			.prepare('INSERT INTO session (id,token,user_id,expires_at,updated_at) VALUES (?,?,?,?,?)')
			.run(randomUUID(), randomUUID(), actor.id, Date.now() + 3600000, Date.now());
		expect(
			client.prepare('SELECT count(*) AS n FROM session WHERE user_id=?').get(actor.id).n
		).toBe(2);
		const otp = seedCode(actor.email);
		const reset = await request.post('/api/auth/email-otp/reset-password', {
			headers,
			data: { email: actor.email, otp, password: newPassword }
		});
		expect(reset.ok()).toBe(true);
		expect(
			client.prepare('SELECT count(*) AS n FROM session WHERE user_id=?').get(actor.id).n
		).toBe(0);
		expect((await (await request.get('/api/auth/get-session')).json())?.user).toBeFalsy();
		expect((await request.get('/api/profile')).status()).toBe(401);
		expect(
			(
				await request.post('/api/auth/email-otp/reset-password', {
					headers,
					data: { email: actor.email, otp, password: oldPassword }
				})
			).ok()
		).toBe(false);
		expect(
			(
				await request.post('/api/auth/sign-in/email', {
					headers,
					data: { email: actor.email, password: oldPassword }
				})
			).ok()
		).toBe(false);
		expect(
			(
				await request.post('/api/auth/sign-in/email', {
					headers,
					data: { email: actor.email, password: newPassword }
				})
			).ok()
		).toBe(true);
	} finally {
		client.close();
	}
});

test('invalid, expired, locked-out, and wrong-email codes cannot change a password', async ({
	request
}) => {
	const actor = await identity();
	const another = await identity();
	const cases = [
		() => {
			seedCode(actor.email);
			return { email: actor.email, otp: '000000' };
		},
		() => ({ email: another.email, otp: seedCode(actor.email) }),
		() => ({ email: actor.email, otp: seedCode(actor.email, { expired: true }) })
	];
	for (const makeInput of cases) {
		const input = makeInput();
		expect(
			(
				await request.post('/api/auth/email-otp/reset-password', {
					headers,
					data: { ...input, password: newPassword }
				})
			).ok()
		).toBe(false);
	}
	const locked = seedCode(actor.email, { attempts: 5 });
	expect(
		(
			await request.post('/api/auth/email-otp/reset-password', {
				headers,
				data: { email: actor.email, otp: locked, password: newPassword }
			})
		).status()
	).toBe(403);
	const valid = seedCode(actor.email);
	for (const password of ['short', 'x'.repeat(129)]) {
		expect(
			(
				await request.post('/api/auth/email-otp/reset-password', {
					headers,
					data: { email: actor.email, otp: valid, password }
				})
			).ok()
		).toBe(false);
	}
	const client = new Database(process.env.HANDLINK_TEST_DB!);
	try {
		const credential = client.prepare('SELECT password FROM account WHERE user_id=?').get(actor.id);
		expect(await verifyPassword({ hash: credential.password, password: oldPassword })).toBe(true);
	} finally {
		client.close();
	}
});

for (const role of ['admin', 'dispatcher']) {
	const portal = role === 'admin' ? 'admin' : 'dispatch';
	test(`${role} recovery verifies the code, checks confirmation, and returns to universal login`, async ({
		page
	}) => {
		const actor = await identity(role);
		let code = seedCode(actor.email);
		// Real delivery was checked separately. Only mail issuance is intercepted here;
		// code validation, password changes, session revocation and login use the server.
		await page.route('**/api/auth/email-otp/request-password-reset', async (route) => {
			expect(route.request().postDataJSON()).toEqual({ email: actor.email });
			code = seedCode(actor.email);
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: '{"success":true}'
			});
		});
		await page.setViewportSize(
			role === 'admin' ? { width: 1366, height: 768 } : { width: 390, height: 844 }
		);
		await page.goto(`/${portal}/forgot-password`);
		await page.waitForLoadState('networkidle');
		await page.getByLabel('Email address', { exact: true }).fill(actor.email);
		await page.getByRole('button', { name: 'Send verification code', exact: true }).click();
		await expect(page.getByText('If an account exists', { exact: false })).toBeVisible();
		await page.getByLabel('Email verification code', { exact: true }).fill('000000');
		await page.getByRole('button', { name: 'Verify code', exact: true }).click();
		await expect(page.getByRole('alert')).toContainText('invalid or expired');
		await page.getByLabel('Email verification code', { exact: true }).fill(code);
		await page.getByRole('button', { name: 'Verify code', exact: true }).click();
		await page.getByLabel('New password', { exact: true }).fill(newPassword);
		await page.getByLabel('Confirm new password', { exact: true }).fill(oldPassword);
		await page.getByRole('button', { name: 'Reset password', exact: true }).click();
		await expect(page.getByRole('alert')).toHaveText('Passwords do not match.');
		await page.getByLabel('Confirm new password', { exact: true }).fill(newPassword);
		await page.getByRole('button', { name: 'Reset password', exact: true }).click();
		await expect(page.getByRole('status')).toContainText('Password updated.');
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
			true
		);
		await page.getByRole('link', { name: 'Back to sign in', exact: true }).click();
		await expect(page).toHaveURL('/login');
		await page.getByLabel('Email', { exact: true }).fill(actor.email);
		await page.getByLabel('Password', { exact: true }).fill(newPassword);
		await page.getByRole('button', { name: 'Log In', exact: true }).click();
		await page.getByRole('button', { name: 'I understand. Continue', exact: true }).click();
		await expect(page).toHaveURL(`/${portal}/security`);
	});
}
