import { expect, test } from '@playwright/test';
import { database, login, provision } from './incident-fixture';

for (const role of ['admin', 'dispatcher'] as const) {
	const root = role === 'admin' ? '/admin' : '/dispatch';
	const label = role === 'admin' ? 'Administrator' : 'Dispatcher';

	test(`${label} can view only their signed-in profile on desktop and mobile`, async ({ page }) => {
		const account = await provision(role);
		const name = `${label} Profile Test`;
		const db = database();
		try {
			db.prepare('UPDATE user SET name = ? WHERE id = ?').run(name, account.id);
		} finally {
			db.close();
		}
		await login(page.request, account);
		await page.setViewportSize({ width: 1280, height: 800 });
		await page.goto(root);
		await page
			.getByRole('navigation', { name: 'Main navigation' })
			.getByRole('link', { name: 'My profile', exact: true })
			.click();
		await expect(page).toHaveURL(`${root}/profile`);
		await expect(page.getByRole('heading', { name: 'My profile', exact: true })).toBeVisible();
		const main = page.getByRole('main');
		await expect(main.getByText(name, { exact: true })).toBeVisible();
		await expect(main.getByText(account.email, { exact: true })).toBeVisible();
		await expect(main.getByText(label, { exact: true })).toBeVisible();
		await expect(main.getByRole('link', { name: /account security/i })).toHaveAttribute(
			'href',
			`${root}/security`
		);
		await page.setViewportSize({ width: 390, height: 844 });
		await expect(main.getByText(account.email, { exact: true })).toBeVisible();
		await page.getByRole('button', { name: 'Open navigation' }).click();
		await expect(
			page.getByRole('navigation').getByRole('link', { name: 'My profile', exact: true })
		).toBeVisible();
		expect(
			await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
		).toBe(true);
		const otherRoot = role === 'admin' ? '/dispatch' : '/admin';
		const forbidden = await page.request.get(`${otherRoot}/profile`, { maxRedirects: 0 });
		expect(forbidden.status()).toBe(403);
		expect(await forbidden.text()).not.toContain(account.email);
	});

	test(`${label} profile requires authenticated MFA`, async ({ page, request }) => {
		const anonymous = await request.get(`${root}/profile`, { maxRedirects: 0 });
		expect(anonymous.status()).toBe(303);
		expect(new URL(anonymous.headers().location, anonymous.url()).pathname).toBe(`${root}/login`);
		const account = await provision(role);
		await login(page.request, account, false);
		const passwordOnly = await page.request.get(`${root}/profile`, { maxRedirects: 0 });
		expect(passwordOnly.status()).toBe(303);
		expect(new URL(passwordOnly.headers().location, passwordOnly.url()).pathname).toBe(
			`${root}/security`
		);
	});
}

test('User accounts cannot open staff profiles', async ({ request }) => {
	await login(request, await provision());
	for (const root of ['/admin', '/dispatch']) {
		expect((await request.get(`${root}/profile`, { maxRedirects: 0 })).status()).toBe(403);
	}
});
