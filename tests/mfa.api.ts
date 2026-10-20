import { expect, test, type APIRequestContext } from '@playwright/test';
import Database from 'better-sqlite3';
import { createHmac, randomUUID } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import { enrollStaffMfa, totp } from './mfa-fixture';

const headers = { Origin: 'http://127.0.0.1:4174' };
const password = 'mfa-test-password-12345';

async function identity(role: string) {
	const id = randomUUID();
	const email = `${id}@example.com`;
	const client = new Database(process.env.HANDLINK_TEST_DB!);
	try {
		client
			.prepare(
				'INSERT INTO user (id,name,email,email_verified,role,updated_at) VALUES (?,?,?,?,?,?)'
			)
			.run(id, 'MFA Test', email, 1, role, Date.now());
		client
			.prepare(
				'INSERT INTO account (id,account_id,provider_id,user_id,password,updated_at) VALUES (?,?,?,?,?,?)'
			)
			.run(randomUUID(), id, 'credential', id, await hashPassword(password), Date.now());
	} finally {
		client.close();
	}
	return { id, email };
}

function post(request: APIRequestContext, path: string, data: object) {
	return request.post('/api/auth/' + path, { headers, data });
}

for (const role of ['admin', 'dispatcher']) {
	const portal = role === 'admin' ? 'admin' : 'dispatch';
	test(`${role}: enrollment and every new login require MFA; backup codes work only once`, async ({
		request,
		playwright
	}) => {
		const actor = await identity(role);
		expect((await post(request, 'sign-in/email', { email: actor.email, password })).ok()).toBe(
			true
		);
		const firstRedirect = await request.get(`/${portal}`, { maxRedirects: 0 });
		expect(new URL(firstRedirect.headers().location, `${headers.Origin}/${portal}`).pathname).toBe(
			`/${portal}/security`
		);
		expect((await request.get('/api/admin/accounts')).status()).toBe(403);
		expect(
			(await post(request, 'update-session', { mfaVerifiedAt: new Date().toISOString() })).ok()
		).toBe(false);
		expect((await post(request, 'update-user', { twoFactorEnabled: true })).ok()).toBe(false);
		expect((await request.get('/api/admin/accounts')).status()).toBe(403);
		for (const action of ['disable', 'get-totp-uri', 'generate-backup-codes']) {
			expect((await post(request, `two-factor/${action}`, { password })).status()).toBe(403);
		}
		const old = await playwright.request.newContext({ baseURL: headers.Origin });
		await post(old, 'sign-in/email', { email: actor.email, password });
		const setupResponse = await post(request, 'two-factor/enable', { password });
		expect(setupResponse.ok()).toBe(true);
		const setup = await setupResponse.json();
		expect(setup.backupCodes).toHaveLength(10);
		const client = new Database(process.env.HANDLINK_TEST_DB!);
		try {
			const stored = client.prepare('SELECT * FROM two_factor WHERE user_id=?').get(actor.id);
			expect(stored.verified).toBe(0);
			expect(stored.secret).not.toBe(new URL(setup.totpURI).searchParams.get('secret'));
			expect(stored.backup_codes).not.toContain(setup.backupCodes[0]);
			expect(
				(
					await post(request, 'two-factor/verify-totp', { code: 'bad', trustDevice: false })
				).status()
			).toBe(400);
			expect(
				(
					await post(request, 'two-factor/verify-totp', {
						code: totp(setup.totpURI),
						trustDevice: true
					})
				).status()
			).toBe(400);
			expect((await request.get('/api/admin/accounts')).status()).toBe(403);
			expect(
				(
					await post(request, 'two-factor/verify-totp', {
						code: totp(setup.totpURI),
						trustDevice: false
					})
				).ok()
			).toBe(true);
			expect((await request.get(`/${portal}`, { maxRedirects: 0 })).status()).toBe(200);
			expect((await old.get('/api/auth/get-session')).ok()).toBe(true);
			expect((await (await old.get('/api/auth/get-session')).json())?.user).toBeFalsy();
			expect(
				client.prepare('SELECT mfa_verified_at FROM session WHERE user_id=?').get(actor.id)
					.mfa_verified_at
			).toBeGreaterThan(0);
			expect((await request.get('/api/admin/accounts')).status()).toBe(
				role === 'admin' ? 200 : 403
			);
			await post(request, 'sign-out', {});
			const challenge = await post(request, 'sign-in/email', { email: actor.email, password });
			expect((await challenge.json()).twoFactorRedirect).toBe(true);
			expect((await request.get('/api/admin/accounts')).status()).toBe(401);
			expect(
				(
					await post(request, 'two-factor/verify-backup-code', {
						code: setup.backupCodes[0],
						trustDevice: false,
						disableSession: false
					})
				).ok()
			).toBe(true);
			expect((await request.get(`/${portal}`, { maxRedirects: 0 })).status()).toBe(200);
			await post(request, 'sign-out', {});
			await post(request, 'sign-in/email', { email: actor.email, password });
			expect(
				(
					await post(request, 'two-factor/verify-backup-code', {
						code: setup.backupCodes[0],
						trustDevice: false
					})
				).ok()
			).toBe(false);
			expect((await request.get('/api/admin/accounts')).status()).toBe(401);
			expect(
				(
					await post(request, 'two-factor/verify-totp', {
						code: totp(setup.totpURI),
						trustDevice: false
					})
				).ok()
			).toBe(true);
			const regenerated = await post(request, 'two-factor/generate-backup-codes', { password });
			expect(regenerated.ok()).toBe(true);
			const replacementCodes = (await regenerated.json()).backupCodes;
			expect(replacementCodes).toHaveLength(10);
			await post(request, 'sign-out', {});
			await post(request, 'sign-in/email', { email: actor.email, password });
			expect(
				(
					await post(request, 'two-factor/verify-backup-code', {
						code: setup.backupCodes[1],
						trustDevice: false
					})
				).ok()
			).toBe(false);
			expect(
				(
					await post(request, 'two-factor/verify-backup-code', {
						code: replacementCodes[0],
						trustDevice: false
					})
				).ok()
			).toBe(true);
			expect((await post(request, 'two-factor/disable', { password })).ok()).toBe(true);
			const replacedRedirect = await request.get(`/${portal}`, { maxRedirects: 0 });
			expect(
				new URL(replacedRedirect.headers().location, `${headers.Origin}/${portal}`).pathname
			).toBe(`/${portal}/security`);
			expect((await request.get('/api/admin/accounts')).status()).toBe(403);
		} finally {
			client.close();
			await old.dispose();
		}
	});
}

for (const role of ['admin', 'dispatcher']) {
	const portal = role === 'admin' ? 'admin' : 'dispatch';
	test(`${role}: browser setup and lost-phone backup login work`, async ({ page }) => {
		const actor = await identity(role);
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto('/login');
		await page.waitForLoadState('networkidle');
		await page.getByLabel('Email', { exact: true }).fill(actor.email);
		await page.getByLabel('Password', { exact: true }).fill(password);
		await page.getByRole('button', { name: 'Log In', exact: true }).click();
		await expect(page).toHaveURL(`/${portal}/security`);
		await page.getByLabel('Current password', { exact: true }).fill(password);
		await page.getByRole('button', { name: 'Start authenticator setup', exact: true }).click();
		const key = page.locator('[aria-label="Authenticator setup key"]');
		await expect(key).toBeVisible();
		const uri = `otpauth://totp/HandLink?secret=${(await key.textContent())!.trim()}`;
		const backupCode = (await page
			.getByRole('list', { name: 'Backup codes' })
			.locator('code')
			.first()
			.textContent())!;
		await expect(
			page.getByRole('button', { name: 'Verify and enable authenticator' })
		).toBeDisabled();
		await page.getByRole('checkbox', { name: 'I saved my backup codes securely.' }).check();
		await page.getByLabel('Authenticator code', { exact: true }).fill(totp(uri));
		await page
			.getByRole('button', { name: 'Verify and enable authenticator', exact: true })
			.click();
		await expect(page.getByText('Authenticator enabled.', { exact: true })).toBeVisible();
		await expect(key).not.toBeVisible();
		await expect(page.getByRole('list', { name: 'Backup codes' })).not.toBeVisible();
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
			true
		);
		await page.getByRole('link', { name: 'Continue to workspace', exact: true }).click();
		await expect(page).toHaveURL(`/${portal}`);
		await post(page.request, 'sign-out', {});
		await page.goto('/login');
		await page.waitForLoadState('networkidle');
		await page.getByLabel('Email', { exact: true }).fill(actor.email);
		await page.getByLabel('Password', { exact: true }).fill(password);
		await page.getByRole('button', { name: 'Log In', exact: true }).click();
		await page.getByRole('button', { name: 'Use a backup code', exact: true }).click();
		await page.getByLabel('Backup code', { exact: true }).fill(backupCode);
		await page.getByRole('button', { name: 'Verify code', exact: true }).click();
		await expect(page).toHaveURL(`/${portal}`);
	});
}

test('email password recovery does not remove the MFA requirement', async ({ request }) => {
	const actor = await identity('admin');
	await post(request, 'sign-in/email', { email: actor.email, password });
	const setup = (await enrollStaffMfa(request, password))!;
	const client = new Database(process.env.HANDLINK_TEST_DB!);
	const otp = '835291';
	try {
		const hash = createHmac('sha256', 'isolated-test-secret-only-012345678901234567890123456789')
			.update(otp)
			.digest('hex');
		client
			.prepare(
				'INSERT INTO verification (id,identifier,value,expires_at,updated_at) VALUES (?,?,?,?,?)'
			)
			.run(
				randomUUID(),
				`forget-password-otp-${actor.email}`,
				`${hash}:0`,
				Date.now() + 300000,
				Date.now()
			);
		const newPassword = 'replacement-password-12345';
		expect(
			(
				await post(request, 'email-otp/reset-password', {
					email: actor.email,
					otp,
					password: newPassword
				})
			).ok()
		).toBe(true);
		expect((await request.get('/api/admin/accounts')).status()).toBe(401);
		expect(
			(
				await (
					await post(request, 'sign-in/email', { email: actor.email, password: newPassword })
				).json()
			).twoFactorRedirect
		).toBe(true);
		expect((await request.get('/api/admin/accounts')).status()).toBe(401);
		expect(
			(
				await post(request, 'two-factor/verify-totp', {
					code: totp(setup.totpURI),
					trustDevice: false
				})
			).ok()
		).toBe(true);
		expect((await request.get('/api/admin/accounts')).status()).toBe(200);
	} finally {
		client.close();
	}
});

test('MFA challenges stop after five failed attempts', async ({ request }) => {
	const actor = await identity('admin');
	await post(request, 'sign-in/email', { email: actor.email, password });
	const setup = (await enrollStaffMfa(request, password))!;
	await post(request, 'sign-out', {});
	await post(request, 'sign-in/email', { email: actor.email, password });
	const valid = totp(setup.totpURI);
	const invalid = String((Number(valid) + 100) % 1000000).padStart(6, '0');
	for (let i = 0; i < 5; i++) {
		expect(
			(await post(request, 'two-factor/verify-totp', { code: invalid, trustDevice: false })).ok()
		).toBe(false);
	}
	expect(
		(
			await post(request, 'two-factor/verify-totp', {
				code: totp(setup.totpURI),
				trustDevice: false
			})
		).ok()
	).toBe(false);
	expect((await request.get('/api/admin/accounts')).status()).toBe(401);
});
