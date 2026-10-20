import { expect, test } from '@playwright/test';
import { headers, login, password, provision } from './incident-fixture';
import { enrollStaffMfa, totp } from './mfa-fixture';

test('one login page routes Users and protects staff destinations with MFA', async ({ page }) => {
	test.setTimeout(120000);
	await page.addInitScript(() =>
		localStorage.setItem('handlink:initial-device-permissions:v1', 'attempted')
	);
	const user = await provision();
	await page.goto('/user/login');
	await expect(page).toHaveURL('/login');
	await page.getByLabel('Email', { exact: true }).fill(user.email);
	await page.getByLabel('Password', { exact: true }).fill(password);
	await page.getByRole('button', { name: 'Show password', exact: true }).click();
	await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'text');
	await page.getByRole('button', { name: 'Log In', exact: true }).click();
	await expect(page).toHaveURL('/user/dashboard');
	await page.request.post('/api/auth/sign-out', { headers, data: {} });
	for (const role of ['admin', 'dispatcher']) {
		const staff = await provision(role);
		await login(page.request, staff, false);
		await page.goto('/login');
		await expect(page).toHaveURL(role === 'admin' ? '/admin/security' : '/dispatch/security');
		const setup = await enrollStaffMfa(page.request, password);
		expect(setup).not.toBeNull();
		await page.request.post('/api/auth/sign-out', { headers, data: {} });
		await page.goto('/login');
		await page.getByLabel('Email', { exact: true }).fill(staff.email);
		await page.getByLabel('Password', { exact: true }).fill(password);
		await page.getByRole('button', { name: 'Log In', exact: true }).click();
		await expect(page.getByLabel('Authenticator code', { exact: true })).toBeVisible();
		await expect(page).toHaveURL('/login');
		await page.getByLabel('Authenticator code', { exact: true }).fill(totp(setup!.totpURI));
		await page.getByRole('button', { name: 'Verify code', exact: true }).click();
		await expect(page).toHaveURL(role === 'admin' ? '/admin' : '/dispatch');
		await page.request.post('/api/auth/sign-out', { headers, data: {} });
	}
});

test('registration blocks incomplete personal fields and defaults phone to +639', async ({
	page
}) => {
	await page.goto('/user/register');
	await expect(page.getByLabel('Phone number', { exact: true })).toHaveValue('+639');
	await page.getByRole('button', { name: 'Continue', exact: true }).click();
	await expect(
		page.getByRole('group', { name: 'Personal information', exact: true })
	).toBeVisible();
	await page.getByLabel('First name', { exact: true }).fill('   ');
	await page.getByLabel('Last name', { exact: true }).fill('Reyes');
	await page.getByLabel('Birthday', { exact: true }).fill('2000-01-01');
	await page.getByLabel('Sex', { exact: true }).selectOption('Female');
	await page.getByLabel('Phone number', { exact: true }).fill('+639171234567');
	await page.getByRole('button', { name: 'Continue', exact: true }).click();
	await expect(
		page.getByRole('group', { name: 'Personal information', exact: true })
	).toBeVisible();
	await page.getByLabel('First name', { exact: true }).fill('Casey');
	await page.getByRole('button', { name: 'Continue', exact: true }).click();
	await expect(page.getByRole('group', { name: /Medical information/ })).toBeVisible();
	await page.getByRole('button', { name: 'Continue', exact: true }).click();
	await expect(page.getByRole('combobox', { name: 'Relationship', exact: true })).toBeVisible();
	await page.getByRole('combobox', { name: 'Relationship', exact: true }).selectOption('Friend');
	await expect(page.getByRole('combobox', { name: 'Relationship', exact: true })).toHaveValue(
		'Friend'
	);
});

test('User navigation stays visible and chosen theme persists across pages', async ({ page }) => {
	await page.emulateMedia({ colorScheme: 'dark' });
	await page.addInitScript(() =>
		localStorage.setItem('handlink:initial-device-permissions:v1', 'attempted')
	);
	await login(page.request, await provision());
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/user/dashboard');
	const nav = page.getByRole('navigation', { name: 'Main navigation' });
	await expect(nav.getByRole('link', { name: 'Home', exact: true })).toHaveAttribute(
		'aria-current',
		'page'
	);
	await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
	await expect(nav).toBeInViewport();
	const desired = page.getByRole('button', { name: 'Switch to light mode', exact: true });
	await desired.click();
	await expect(page.locator('html')).toHaveAttribute('data-appearance', 'light');
	await page.screenshot({
		path: test.info().outputPath('user-dashboard-light.png'),
		fullPage: true,
		animations: 'disabled'
	});
	await nav.getByRole('link', { name: 'Settings', exact: true }).click();
	await expect(page).toHaveURL('/user/settings');
	await expect(page.locator('html')).toHaveAttribute('data-appearance', 'light');
	await page.reload();
	await expect(page).toHaveURL('/user/settings');
	await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
	await expect(page.locator('html')).toHaveAttribute('data-appearance', 'light');
	await page.screenshot({
		path: test.info().outputPath('user-settings-light.png'),
		fullPage: true,
		animations: 'disabled'
	});
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
	await page.getByRole('button', { name: 'Switch to dark mode', exact: true }).click();
	await expect(page.locator('html')).toHaveAttribute('data-appearance', 'dark');
});

test('Admin dashboard shows real summary and usable mobile sidebar', async ({ page }) => {
	test.setTimeout(60000);
	await page.emulateMedia({ colorScheme: 'dark' });
	await login(page.request, await provision('admin'));
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/admin');
	await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
	await expect(page.getByRole('region', { name: 'System summary', exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
	await expect(page.getByRole('dialog')).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(page.getByRole('dialog')).not.toBeVisible();
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
	await page.screenshot({
		path: test.info().outputPath('admin-dashboard-mobile.png'),
		fullPage: true,
		animations: 'disabled'
	});
	await page.setViewportSize({ width: 1440, height: 1000 });
	const light = page.getByRole('button', { name: 'Switch to light mode', exact: true });
	if (await light.count()) await light.click();
	await page.screenshot({
		path: test.info().outputPath('admin-dashboard-light.png'),
		fullPage: true,
		animations: 'disabled'
	});
});
