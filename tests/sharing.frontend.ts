import { expect, test } from '@playwright/test';
import { database, headers, login, origin, provision } from './incident-fixture';
import { approveSharingTrust, expireSharing, sharingInput } from './sharing-fixture';

test('one-minute sharing warning reaches owner and trusted viewer and clears after stopping or expiry', async ({
	page,
	browser
}) => {
	test.setTimeout(60000);
	const owner = await provision(),
		viewer = await provision();
	approveSharingTrust(owner.profileId, viewer.profileId);
	await login(page.request, owner);
	const receiver = await browser.newContext({ baseURL: origin });
	async function createNearExpiry(remaining: number) {
		const created = await page.request.post('/api/sharing', {
			headers,
			data: sharingInput(viewer.id)
		});
		expect(created.ok()).toBe(true);
		const id = (await created.json()).session.id;
		const db = database();
		try {
			db.prepare('UPDATE location_session SET created_at=?,expires_at=? WHERE id=?').run(
				Date.now() - 60000,
				Date.now() + remaining,
				id
			);
		} finally {
			db.close();
		}
		return id;
	}
	try {
		await login(receiver.request, viewer);
		await createNearExpiry(45000);
		await page.goto('/user/dashboard');
		const warning = page.getByRole('status').filter({
			hasText: 'Your location sharing ends in less than a minute.'
		});
		await expect(warning).toBeVisible();
		await expect(warning.getByRole('link', { name: 'Manage location sharing' })).toBeVisible();
		const viewerPage = await receiver.newPage();
		await viewerPage.goto('/user/notifications');
		await expect(
			viewerPage.getByRole('heading', { name: 'Casey Reyes shared their location with you' })
		).toBeVisible();
		await expect(
			viewerPage.getByText('Your location sharing ends in less than a minute.')
		).toHaveCount(0);
		await expect(
			viewerPage.getByRole('heading', { name: 'Your location-sharing reminder' })
		).toHaveCount(0);
		await expect(
			viewerPage.getByRole('heading', { name: "Casey Reyes's location-sharing reminder" })
		).toBeVisible();
		const viewerWarning = viewerPage.getByRole('status').filter({
			hasText: "Casey Reyes's location sharing ends in less than a minute."
		});
		await expect(viewerWarning).toBeVisible();
		await expect(viewerWarning.getByRole('link', { name: 'View location' })).toBeVisible();
		await page.bringToFront();
		await page.goto('/user/notifications');
		await expect(
			page.getByRole('heading', { name: 'Your location-sharing reminder' })
		).toBeVisible();
		await warning.getByRole('link', { name: 'Manage location sharing' }).click();
		await page.getByRole('button', { name: 'Stop sharing', exact: true }).click();
		await expect(page.getByText('Location sharing stopped.', { exact: true })).toBeVisible();
		await expect(warning).toHaveCount(0);
		await page.goto('/user/notifications');
		await expect(
			page.getByText('This location sharing is no longer active.', { exact: false })
		).toBeVisible();
		await expect(page.getByRole('link', { name: 'Manage location sharing' })).toHaveCount(0);
		await viewerPage.bringToFront();
		await viewerPage.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
		await expect(viewerWarning).toHaveCount(0, { timeout: 15000 });
		await expect(viewerPage.getByRole('link', { name: 'View location' })).toHaveCount(0);

		await createNearExpiry(7000);
		await page.bringToFront();
		await page.goto('/user/dashboard');
		await expect(warning).toBeVisible();
		await viewerPage.bringToFront();
		await viewerPage.goto('/user/dashboard');
		await expect(viewerWarning).toBeVisible();
		await expect(viewerWarning).toHaveCount(0, { timeout: 12000 });
		await page.bringToFront();
		await expect(warning).toHaveCount(0, { timeout: 10000 });
		await page.goto('/user/notifications');
		await expect(page.getByText('Your location sharing ends in less than a minute.')).toHaveCount(
			0
		);
	} finally {
		await receiver.close();
	}
});

test('sharing sends GPS, continues across pages, shows real map only on request, and stops access', async ({
	page,
	browser
}) => {
	test.setTimeout(120000);
	const owner = await provision(),
		viewer = await provision();
	approveSharingTrust(owner.profileId, viewer.profileId);
	await login(page.request, owner);
	await page.context().grantPermissions(['geolocation']);
	await page.context().setGeolocation({ latitude: 14.5995, longitude: 120.9842 });
	await page.setViewportSize({ width: 390, height: 844 });
	const context = await browser.newContext({ baseURL: origin });
	try {
		await login(context.request, viewer);
		const receiving = await context.newPage();
		await receiving.route('https://www.openstreetmap.org/**', (route) =>
			route.fulfill({
				contentType: 'text/html',
				body: '<html><body>Test map provider</body></html>'
			})
		);
		await page.goto('/user/sharing');
		await expect(page.getByRole('checkbox', { name: /Casey Reyes/ })).not.toBeChecked();
		await page.getByRole('checkbox', { name: /Casey Reyes/ }).check();
		await page.getByLabel('Set location sharing timer', { exact: false }).fill('15');
		await page.getByRole('button', { name: 'Share location', exact: true }).click();
		await expect(page.getByText('Location sharing active', { exact: true })).toBeVisible();
		const id = (await (await page.request.get('/api/sharing')).json()).own.id;
		await receiving.goto('/user/notifications');
		await expect(
			receiving.getByRole('heading', {
				name: 'Casey Reyes shared their location with you',
				exact: true
			})
		).toBeVisible();
		await receiving.getByRole('link', { name: 'View location', exact: true }).click();
		await expect(
			receiving.getByRole('heading', { name: "Casey Reyes's location", exact: true })
		).toBeVisible();
		await expect(receiving.locator('iframe')).toHaveCount(0);
		await receiving.getByRole('button', { name: 'Load map', exact: true }).click();
		await expect(receiving.getByTitle('Map of Casey Reyes')).toBeVisible();
		await expect(receiving.getByTitle('Map of Casey Reyes')).toHaveAttribute(
			'src',
			/marker=14.5995%2C120.9842/
		);
		await page.goto('/user/dashboard');
		const db = database();
		try {
			db.prepare('UPDATE location_point SET recorded_at=? WHERE session_id=?').run(
				Date.now() - 301000,
				id
			);
		} finally {
			db.close();
		}
		await page.context().setGeolocation({ latitude: 14.61, longitude: 120.99 });
		await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
		await expect
			.poll(
				async () => {
					const response = await page.request.get('/api/sharing');
					return (await response.json()).own.point.latitude;
				},
				{ timeout: 20000 }
			)
			.toBe(14.61);
		await receiving.bringToFront();
		await receiving.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
		await expect(receiving.getByTitle('Map of Casey Reyes')).toHaveAttribute(
			'src',
			/marker=14.61%2C120.99/,
			{ timeout: 15000 }
		);
		await page.bringToFront();
		await page.goto('/user/sharing');
		await page.getByRole('button', { name: 'Stop sharing', exact: true }).click();
		await expect(page.getByText('Location sharing stopped.', { exact: true })).toBeVisible();
		await receiving.bringToFront();
		await receiving.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
		await expect(
			receiving.getByRole('heading', { name: 'Location unavailable', exact: true })
		).toBeVisible({ timeout: 15000 });
		await expect(receiving.locator('iframe')).toHaveCount(0);
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
			true
		);
	} finally {
		await context.close();
	}
});

test('denied location never creates a sharing session', async ({ page }) => {
	const owner = await provision(),
		viewer = await provision();
	approveSharingTrust(owner.profileId, viewer.profileId);
	await login(page.request, owner);
	await page.addInitScript(() => {
		navigator.geolocation.getCurrentPosition = (_success, error) =>
			error?.({
				code: 1,
				message: 'Denied',
				PERMISSION_DENIED: 1,
				POSITION_UNAVAILABLE: 2,
				TIMEOUT: 3
			});
	});
	await page.goto('/user/sharing');
	await page.getByRole('checkbox', { name: /Casey Reyes/ }).check();
	await page.getByRole('button', { name: 'Share location', exact: true }).click();
	await expect(page.getByRole('alert')).toContainText(/location/i);
	expect((await (await page.request.get('/api/sharing')).json()).own).toBeNull();
});

test('lost start response recovers saved session and expired timer notifies both people without SOS', async ({
	page,
	browser
}) => {
	test.setTimeout(90000);
	const owner = await provision(),
		viewer = await provision();
	approveSharingTrust(owner.profileId, viewer.profileId);
	await login(page.request, owner);
	await page.context().grantPermissions(['geolocation']);
	await page.context().setGeolocation({ latitude: 14.5995, longitude: 120.9842 });
	let lost = false;
	await page.route('**/api/sharing', async (route) => {
		if (route.request().method() === 'POST' && !lost) {
			lost = true;
			const response = await route.fetch();
			expect(response.status()).toBe(200);
			await route.abort('failed');
		} else await route.continue();
	});
	const receiving = await browser.newContext({ baseURL: origin });
	try {
		await login(receiving.request, viewer);
		await page.goto('/user/sharing');
		await page.getByRole('checkbox', { name: /Casey Reyes/ }).check();
		await page.getByRole('button', { name: 'Share location', exact: true }).click();
		await expect(page.getByText('Location sharing active', { exact: true })).toBeVisible();
		const id = (await (await page.request.get('/api/sharing')).json()).own.id;
		expireSharing(id);
		await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
		await expect(
			page.getByText('Your sharing timer ended. Location access has stopped.', { exact: true })
		).toBeVisible({ timeout: 15000 });
		await page.goto('/user/notifications');
		await expect(
			page.getByRole('heading', { name: "Casey Reyes's location timer ended", exact: true })
		).toBeVisible();
		const receiverPage = await receiving.newPage();
		await receiverPage.goto('/user/notifications');
		await expect(
			receiverPage.getByRole('heading', { name: "Casey Reyes's location timer ended", exact: true })
		).toBeVisible();
		await expect(
			receiverPage.getByRole('link', { name: 'View location', exact: true })
		).toHaveCount(0);
		const db = database();
		try {
			expect(
				db
					.prepare('SELECT count(*) n FROM location_session WHERE owner_profile_id=?')
					.get(owner.profileId)
			).toEqual({ n: 1 });
			expect(
				db.prepare('SELECT count(*) n FROM incident WHERE caller_user_id=?').get(owner.id)
			).toEqual({ n: 0 });
		} finally {
			db.close();
		}
	} finally {
		await receiving.close();
	}
});

test('revoked viewer loses an already-loaded map; stale publisher errors still allow stopping', async ({
	page,
	browser
}) => {
	test.setTimeout(90000);
	const owner = await provision(),
		viewer = await provision();
	const connection = approveSharingTrust(owner.profileId, viewer.profileId);
	await login(page.request, owner);
	const created = await page.request.post('/api/sharing', {
		headers,
		data: sharingInput(viewer.id)
	});
	const id = (await created.json()).session.id;
	const db = database();
	try {
		db.prepare('UPDATE location_session SET created_at=?,expires_at=? WHERE id=?').run(
			Date.now() - 60000,
			Date.now() + 45000,
			id
		);
		db.prepare('UPDATE location_point SET recorded_at=? WHERE session_id=?').run(
			Date.now() - 301000,
			id
		);
	} finally {
		db.close();
	}
	await page.addInitScript(() => {
		navigator.geolocation.getCurrentPosition = (_success, error) =>
			error?.({
				code: 1,
				message: 'Denied',
				PERMISSION_DENIED: 1,
				POSITION_UNAVAILABLE: 2,
				TIMEOUT: 3
			});
	});
	const context = await browser.newContext({ baseURL: origin });
	try {
		await login(context.request, viewer);
		const receiver = await context.newPage();
		await receiver.route('https://www.openstreetmap.org/**', (route) =>
			route.fulfill({ contentType: 'text/html', body: '<html>Map</html>' })
		);
		await receiver.goto(`/user/sharing/view?id=${id}`);
		const viewerWarning = receiver.getByRole('status').filter({
			hasText: "Casey Reyes's location sharing ends in less than a minute."
		});
		await expect(viewerWarning).toBeVisible();
		await receiver.getByRole('button', { name: 'Load map', exact: true }).click();
		await expect(receiver.getByTitle('Map of Casey Reyes')).toBeVisible();
		await page.goto('/user/sharing');
		await expect(page.getByText(/Location update failed/)).toBeVisible();
		expect(
			(
				await page.request.patch(`/api/trusted/${connection}`, {
					headers,
					data: { action: 'revoke' }
				})
			).status()
		).toBe(200);
		await receiver.bringToFront();
		await receiver.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
		await expect(
			receiver.getByRole('heading', { name: 'Location unavailable', exact: true })
		).toBeVisible({ timeout: 15000 });
		await expect(receiver.locator('iframe')).toHaveCount(0);
		await expect(viewerWarning).toHaveCount(0, { timeout: 15000 });
		await page.bringToFront();
		await page.getByRole('button', { name: 'Stop sharing', exact: true }).click();
		await expect(page.getByText('Location sharing stopped.', { exact: true })).toBeVisible();
	} finally {
		await context.close();
	}
});
