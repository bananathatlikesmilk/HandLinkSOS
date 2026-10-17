import { expect, test } from '@playwright/test';
import { database, headers, login, origin, provision } from './incident-fixture';
import { installNativeBridge, type NativeTestState } from './native-fixture';

const endpoint = '/api/push/devices';
const input = { platform: 'android', pushToken: 'fixture-token-12345678901234567890' };

test('push API validates roles, CSRF, ownership, token rotation and logout binding', async ({
	request,
	playwright
}) => {
	test.setTimeout(90000);
	expect((await request.get(endpoint)).status()).toBe(401);
	const owner = await provision();
	await login(request, owner);
	expect((await request.get(endpoint)).status()).toBe(200);
	for (const data of [
		{ ...input, userId: 'someone-else' },
		{ ...input, platform: 'ios' },
		{ ...input, pushToken: 'bad token' },
		{ ...input, pushToken: 'x'.repeat(4097) }
	]) {
		expect((await request.post(endpoint, { headers, data })).status()).toBe(422);
	}
	expect(
		(
			await request.post(endpoint, { headers: { Origin: 'https://other.example' }, data: input })
		).status()
	).toBe(403);
	expect((await request.post(endpoint, { headers, data: input })).status()).toBe(200);
	expect((await request.post(endpoint, { headers, data: input })).status()).toBe(200);
	const db = database();
	const other = await playwright.request.newContext({ baseURL: origin });
	try {
		expect(db.prepare('SELECT count(*) n FROM device WHERE user_id=?').get(owner.id)).toEqual({
			n: 1
		});
		const second = await provision();
		await login(other, second);
		expect((await other.delete(endpoint, { headers, data: input })).status()).toBe(200);
		expect(
			db.prepare('SELECT revoked_at FROM device WHERE push_token=?').get(input.pushToken)
		).toEqual({ revoked_at: null });
		expect((await other.post(endpoint, { headers, data: input })).status()).toBe(200);
		expect(
			db.prepare('SELECT user_id FROM device WHERE push_token=?').get(input.pushToken)
		).toEqual({ user_id: second.id });
		const rotated = { ...input, pushToken: input.pushToken + '-rotated' };
		expect((await other.post(endpoint, { headers, data: rotated })).status()).toBe(200);
		expect(
			db.prepare('SELECT revoked_at FROM device WHERE push_token=?').get(input.pushToken).revoked_at
		).toBeTruthy();
		expect((await other.post('/api/auth/sign-out', { headers, data: {} })).ok()).toBe(true);
		expect(db.prepare('SELECT count(*) n FROM device WHERE user_id=?').get(second.id)).toEqual({
			n: 0
		});
		await login(other, await provision('dispatcher'));
		expect((await other.get(endpoint)).status()).toBe(403);
		const sessionId = db.prepare('SELECT id FROM session WHERE user_id=?').get(owner.id).id;
		for (let n = 0; n < 20; n++)
			db.prepare(
				"INSERT INTO device (id,user_id,session_id,platform,push_token,revoked_at) VALUES (?,?,?,'android',?,?)"
			).run(crypto.randomUUID(), owner.id, sessionId, 'fixture-rate-token-' + n, Date.now());
		expect(
			(
				await request.post(endpoint, {
					headers,
					data: { ...input, pushToken: input.pushToken + '-limited' }
				})
			).status()
		).toBe(429);
	} finally {
		db.close();
		await other.dispose();
	}
});

test('Android notification controls require opt-in, register, disable and honor denied permission', async ({
	page
}) => {
	test.setTimeout(60000);
	await login(page.request, await provision());
	await installNativeBridge(page);
	await page.goto('/user/settings');
	const enable = page.getByRole('button', { name: 'Enable phone notifications', exact: true });
	await expect(enable).toBeEnabled();
	expect(
		await page.evaluate(
			() =>
				(globalThis as unknown as { __handlinkNativeTest: NativeTestState }).__handlinkNativeTest
					.pushRequests
		)
	).toBe(0);
	await enable.click();
	const disable = page.getByRole('button', { name: 'Disable phone notifications', exact: true });
	await expect(disable).toBeVisible();
	expect((await (await page.request.get(endpoint)).json()).enabled).toBe(true);
	await disable.click();
	await expect(enable).toBeVisible();
	expect((await (await page.request.get(endpoint)).json()).enabled).toBe(false);
	await page.evaluate(() => {
		(
			globalThis as unknown as { __handlinkNativeTest: NativeTestState }
		).__handlinkNativeTest.pushDeny = true;
	});
	await enable.click();
	await expect(page.getByRole('alert').filter({ hasText: 'Allow notifications' })).toBeVisible();
	expect((await (await page.request.get(endpoint)).json()).enabled).toBe(false);
});
