import { expect, test } from '@playwright/test';
import { database, login, provision } from './incident-fixture';
import { approveSharingTrust } from './sharing-fixture';
import { installNativeBridge, type NativeTestState } from './native-fixture';

test('Android controls explicitly enable native updates and avoid duplicate browser publishing', async ({
	page
}) => {
	test.setTimeout(90000);
	const owner = await provision(),
		viewer = await provision();
	approveSharingTrust(owner.profileId, viewer.profileId);
	await login(page.request, owner);
	await installNativeBridge(page);
	await page.goto('/user/sharing');
	await page.getByRole('checkbox', { name: /Casey Reyes/ }).check();
	await page.getByRole('button', { name: 'Share location', exact: true }).click();
	await expect(
		page.getByRole('heading', { name: 'Android screen-off updates', exact: true })
	).toBeVisible();
	await expect(
		page.getByRole('button', { name: 'Enable screen-off updates', exact: true })
	).toBeVisible();
	expect(
		await page.evaluate(
			() =>
				(globalThis as unknown as { __handlinkNativeTest: NativeTestState }).__handlinkNativeTest
					.starts
		)
	).toBe(0);
	await page.getByRole('button', { name: 'Enable screen-off updates', exact: true }).click();
	await expect(
		page.getByRole('button', { name: 'Disable screen-off updates', exact: true })
	).toBeVisible();
	const sharing = (await (await page.request.get('/api/sharing')).json()).own;
	const db = database();
	try {
		db.prepare('UPDATE location_point SET recorded_at=? WHERE session_id=?').run(
			Date.now() - 301000,
			sharing.id
		);
	} finally {
		db.close();
	}
	let browserUpdates = 0;
	page.on('request', (request) => {
		if (request.url().endsWith('/points') && request.method() === 'POST') browserUpdates++;
	});
	const before = await page.evaluate(
		() =>
			(globalThis as unknown as { __handlinkNativeTest: NativeTestState }).__handlinkNativeTest
				.statusChecks
	);
	await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					(globalThis as unknown as { __handlinkNativeTest: NativeTestState }).__handlinkNativeTest
						.statusChecks
			)
		)
		.toBeGreaterThan(before);
	expect(browserUpdates).toBe(0);
	await page.getByRole('button', { name: 'Disable screen-off updates', exact: true }).click();
	await expect(
		page.getByRole('button', { name: 'Enable screen-off updates', exact: true })
	).toBeVisible();
	expect((await (await page.request.get('/api/sharing')).json()).own.status).toBe('active');
	await page.getByRole('button', { name: 'Stop sharing', exact: true }).click();
	await expect(page.getByText('Location sharing stopped.', { exact: true })).toBeVisible();
	expect(
		await page.evaluate(
			() =>
				(globalThis as unknown as { __handlinkNativeTest: NativeTestState }).__handlinkNativeTest
					.active
		)
	).toBe(false);
});

test('denied native permission leaves sharing active; late enable cannot restart after Stop sharing', async ({
	page
}) => {
	test.setTimeout(90000);
	const owner = await provision(),
		viewer = await provision();
	approveSharingTrust(owner.profileId, viewer.profileId);
	await login(page.request, owner);
	await installNativeBridge(page);
	await page.goto('/user/sharing');
	await page.getByRole('checkbox', { name: /Casey Reyes/ }).check();
	await page.getByRole('button', { name: 'Share location', exact: true }).click();
	await page.evaluate(() => {
		(globalThis as unknown as { __handlinkNativeTest: NativeTestState }).__handlinkNativeTest.deny =
			true;
	});
	await page.getByRole('button', { name: 'Enable screen-off updates', exact: true }).click();
	await expect(page.getByRole('alert')).toContainText('Android settings');
	expect((await (await page.request.get('/api/sharing')).json()).own.status).toBe('active');
	await page.evaluate(() => {
		const native = (globalThis as unknown as { __handlinkNativeTest: NativeTestState })
			.__handlinkNativeTest;
		native.deny = false;
		native.delay = true;
	});
	await page.getByRole('button', { name: 'Enable screen-off updates', exact: true }).click();
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					(globalThis as unknown as { __handlinkNativeTest: NativeTestState }).__handlinkNativeTest
						.starts
			)
		)
		.toBe(2);
	await page.getByRole('button', { name: 'Stop sharing', exact: true }).click();
	await expect(page.getByText('Location sharing stopped.', { exact: true })).toBeVisible();
	await page.evaluate(() =>
		(
			globalThis as unknown as { __handlinkNativeTest: NativeTestState }
		).__handlinkNativeTest.finishStart?.()
	);
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					(globalThis as unknown as { __handlinkNativeTest: NativeTestState }).__handlinkNativeTest
						.active
			)
		)
		.toBe(false);
	expect((await (await page.request.get('/api/sharing')).json()).own.status).toBe('cancelled');
});

test('logout stops native updates; location switch opens settings without creating sharing', async ({
	page
}) => {
	test.setTimeout(90000);
	const owner = await provision(),
		viewer = await provision();
	approveSharingTrust(owner.profileId, viewer.profileId);
	await login(page.request, owner);
	await installNativeBridge(page);
	await page.goto('/user/settings');
	await page.getByRole('switch', { name: 'Location access', exact: true }).click();
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					(globalThis as unknown as { __handlinkNativeTest: NativeTestState }).__handlinkNativeTest
						.appSettingsOpens
			)
		)
		.toBe(1);
	expect(
		await page.evaluate(
			() =>
				(globalThis as unknown as { __handlinkNativeTest: NativeTestState }).__handlinkNativeTest
					.locationPermission
		)
	).toBe('granted');
	expect((await (await page.request.get('/api/sharing')).json()).own).toBeNull();
	await page.goto('/user/sharing');
	await page.getByRole('checkbox', { name: /Casey Reyes/ }).check();
	await page.getByRole('button', { name: 'Share location', exact: true }).click();
	await page.getByRole('button', { name: 'Enable screen-off updates', exact: true }).click();
	await expect(
		page.getByRole('button', { name: 'Disable screen-off updates', exact: true })
	).toBeVisible();
	await page.getByRole('link', { name: 'Settings', exact: true }).click();
	expect(
		await page.evaluate(
			() =>
				(globalThis as unknown as { __handlinkNativeTest: NativeTestState }).__handlinkNativeTest
					.active
		)
	).toBe(true);
	await page.getByRole('button', { name: 'Log out', exact: true }).click();
	await expect(page).toHaveURL(/\/login$/);
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					(globalThis as unknown as { __handlinkNativeTest: NativeTestState }).__handlinkNativeTest
						.active
			)
		)
		.toBe(false);
	expect(
		await page.evaluate(
			() =>
				(globalThis as unknown as { __handlinkNativeTest: NativeTestState }).__handlinkNativeTest
					.stops
		)
	).toBeGreaterThan(0);
});
