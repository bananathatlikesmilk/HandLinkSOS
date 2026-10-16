import { expect, test } from '@playwright/test';

test('entry and login screens have no role selector or demo wording', async ({ page }) => {
	await page.goto('/');
	await expect(page).toHaveURL('/user');
	await expect(page.getByRole('link', { name: 'Log In', exact: true })).toBeVisible();
	for (const path of ['/user/login', '/admin/login', '/dispatch/login']) {
		await page.goto(path);
		await expect(page.getByRole('radio')).toHaveCount(0);
		await expect(page.locator('body')).not.toContainText('Frontend preview');
		await expect(page.locator('form')).toHaveAttribute('method', 'POST');
	}
});

test('protected portals redirect anonymous visitors to their own login', async ({ page }) => {
	for (const [path, login] of [
		['/user/dashboard', '/user/login'],
		['/admin', '/admin/login'],
		['/dispatch', '/dispatch/login']
	]) {
		await page.goto(path);
		await expect(page).toHaveURL(login);
	}
});

test('unknown credentials never open a dashboard', async ({ page }) => {
	await page.goto('/user/login');
	await page.waitForLoadState('networkidle');
	await page.getByLabel('Email', { exact: true }).fill('unknown@example.com');
	await page.getByLabel('Password', { exact: true }).fill('not-a-real-password');
	await page.getByLabel('Re-password', { exact: true }).fill('not-a-real-password');
	await page.getByRole('button', { name: 'Log In', exact: true }).click();
	await expect(page.getByRole('alert')).toBeVisible();
	await expect(page).toHaveURL('/user/login');
});
