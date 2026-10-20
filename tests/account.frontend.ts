import { expect, test } from '@playwright/test';
import Database from 'better-sqlite3';
import { hashPassword } from 'better-auth/crypto';
import { enrollStaffMfa, totp } from './mfa-fixture';
import { signInWithRateLimit } from './auth-fixture';

async function identity(role = 'user') {
	const id = crypto.randomUUID();
	const email = `${id}@example.com`;
	const password = 'test-password-123456';
	const hash = await hashPassword(password);
	const client = new Database(process.env.HANDLINK_TEST_DB!);
	client
		.prepare('INSERT INTO user (id,name,email,email_verified,role,updated_at) VALUES (?,?,?,?,?,?)')
		.run(id, 'Test User', email, 1, role, Date.now());
	client
		.prepare(
			'INSERT INTO account (id,account_id,provider_id,user_id,password,updated_at) VALUES (?,?,?,?,?,?)'
		)
		.run(crypto.randomUUID(), id, 'credential', id, hash, Date.now());
	client.close();
	return { id, email, password };
}

test('real User login, profile saving, reload and logout work', async ({ page }) => {
	const account = await identity();
	await page.goto('/login');
	await page.waitForLoadState('networkidle');
	await page.getByLabel('Email', { exact: true }).fill(account.email);
	await page.getByLabel('Password', { exact: true }).fill(account.password);
	await page.getByRole('button', { name: 'Log In', exact: true }).click();
	await expect(page).toHaveURL('/user/dashboard');
	const signedIn = page.getByRole('region', { name: 'Signed-in account', exact: true });
	await expect(signedIn).toContainText(account.email);
	await expect(signedIn).toContainText('Test User');
	await expect(signedIn).toContainText('User');
	await expect(page.locator('body')).not.toContainText('Maria Santos');
	await expect(page.getByRole('button', { name: /Start SOS/ })).toBeDisabled();
	await page.goto('/user/profiles/edit');
	const personal = page
		.locator('fieldset')
		.filter({ has: page.getByText('Personal information', { exact: true }) })
		.last();
	await personal.getByLabel('First name', { exact: true }).fill('Casey');
	await personal.getByLabel('Last name', { exact: true }).fill('Reyes');
	await page.getByLabel('Birthday', { exact: true }).fill('2000-01-01');
	await page.getByRole('combobox', { name: 'Sex', exact: true }).selectOption('Other');
	await personal.getByLabel('Phone number', { exact: true }).fill('09171234567');
	await page.getByLabel('Allergies', { exact: true }).fill('PRIVATE-ALLERGY');
	const contact = page.getByRole('region', { name: 'Emergency contact 1', exact: true });
	await contact.getByLabel('First name', { exact: true }).fill('Robin');
	await contact.getByLabel('Last name', { exact: true }).fill('Reyes');
	await contact.getByLabel('Phone number', { exact: true }).fill('09171234567');
	await contact.getByLabel('Email', { exact: true }).fill('robin@example.com');
	await contact.getByLabel('Relationship', { exact: true }).selectOption('Sibling');
	await page.getByRole('button', { name: 'Save changes', exact: true }).click();
	await expect(page).toHaveURL('/user/profiles/details');
	await page.reload();
	await expect(page.locator('body')).toContainText('PRIVATE-ALLERGY');
	await expect(page.locator('body')).toContainText('+639171234567');
	await page.goto('/user/sharing');
	await expect(
		page.getByRole('heading', { name: 'Share location to your circle', exact: true })
	).toBeVisible();
	await page.goto('/user/settings');
	await page.getByRole('button', { name: 'Log out', exact: true }).click();
	await expect(page).toHaveURL('/login');
	await expect(signedIn).toHaveCount(0);
	await page.goto('/user/profiles');
	await expect(page).toHaveURL('/login');
});

for (const [role, path] of [
	['dispatcher', 'dispatch'],
	['admin', 'admin']
]) {
	test(`universal login routes ${role} to its portal and signs out`, async ({ page }) => {
		await page.setViewportSize(
			role === 'dispatcher' ? { width: 390, height: 844 } : { width: 1366, height: 768 }
		);
		const account = await identity(role);
		await signInWithRateLimit(page.request, account.email, account.password);
		const setup = await enrollStaffMfa(page.request, account.password);
		await page.request.post('/api/auth/sign-out', {
			headers: { Origin: 'http://127.0.0.1:4174' },
			data: {}
		});
		await page.goto(`/${path}/login`);
		await expect(page).toHaveURL('/login');
		await page.waitForLoadState('networkidle');
		await page.getByLabel('Email', { exact: true }).fill(account.email);
		await page.getByLabel('Password', { exact: true }).fill(account.password);
		await page.getByRole('button', { name: 'Log In', exact: true }).click();
		await page.getByLabel('Authenticator code', { exact: true }).fill(totp(setup!.totpURI));
		await page.getByRole('button', { name: 'Verify code', exact: true }).click();
		await expect(page).toHaveURL(`/${path}`);
		const menu = page.getByRole('button', { name: 'Open navigation', exact: true });
		if (await menu.isVisible()) await menu.click();
		const signedIn = page.getByRole('region', { name: 'Signed-in account', exact: true });
		await expect(signedIn).toContainText(account.email);
		await expect(signedIn).toContainText('Test User');
		await expect(signedIn).toContainText(role === 'admin' ? 'Administrator' : 'Dispatcher');
		await page.reload();
		if (await menu.isVisible()) await menu.click();
		await expect(signedIn).toContainText(account.email);
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
			true
		);
		const forbidden = await page.request.get('/user/dashboard');
		expect(forbidden.status()).toBe(403);
		await page.getByRole('button', { name: 'Log out', exact: true }).click();
		await expect(page).toHaveURL('/login');
		await expect(signedIn).toHaveCount(0);
		await page.goto(`/${path}`);
		await expect(page).toHaveURL('/login');
	});
}
