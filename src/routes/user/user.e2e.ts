import { expect, test } from '@playwright/test';

test('User private pages require a real session', async ({ page }) => {
	for (const path of [
		'/user/profiles',
		'/user/profiles/edit',
		'/user/settings',
		'/user/sharing',
		'/user/call'
	]) {
		await page.goto(path);
		await expect(page).toHaveURL('/user/login');
	}
});

test('public User screens remain readable on mobile without demo codes', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	for (const path of [
		'/user',
		'/user/login',
		'/user/register',
		'/user/verify',
		'/user/forgot-password',
		'/user/reset-password'
	]) {
		await page.goto(path);
		expect(
			await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
		).toBe(true);
		await expect(page.locator('body')).not.toContainText('123456');
		await expect(page.locator('body')).not.toContainText('Frontend preview');
	}
});
