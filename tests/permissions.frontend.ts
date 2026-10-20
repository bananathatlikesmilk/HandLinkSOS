import { expect, test, type Page } from '@playwright/test';
import { login, password, provision } from './incident-fixture';
import { installNativeBridge, type NativeTestState } from './native-fixture';

const state = (page: Page) =>
	page.evaluate(
		() => (globalThis as unknown as { __handlinkNativeTest: NativeTestState }).__handlinkNativeTest
	);

test('User login survives a browser restart, skips welcome, and logout revokes the saved session', async ({
	page,
	browser
}) => {
	const account = await provision();
	await page.addInitScript(() =>
		localStorage.setItem('handlink:initial-device-permissions:v1', 'attempted')
	);
	await page.goto('/user/login');
	await page.getByLabel('Email', { exact: true }).fill(account.email);
	await page.getByLabel('Password', { exact: true }).fill(password);
	await page.getByRole('button', { name: 'Log In', exact: true }).click();
	await expect(page).toHaveURL('/user/dashboard');
	const saved = await page.context().storageState();
	const token = saved.cookies.find((cookie) => cookie.name.endsWith('session_token'));
	expect(token?.httpOnly).toBe(true);
	expect(token?.expires).toBeGreaterThan(Date.now() / 1000);
	// Closing an app discards session-only cookies; restore only cookies saved to disk.
	const restored = { ...saved, cookies: saved.cookies.filter((cookie) => cookie.expires > 0) };
	const restarted = await browser.newContext({ storageState: restored });
	try {
		const reopened = await restarted.newPage();
		await reopened.goto('/user');
		await expect(reopened).toHaveURL('/user/dashboard');
		await reopened.goto('/user/login');
		await expect(reopened).toHaveURL('/user/dashboard');
		await reopened.goto('/user/settings');
		await reopened.getByRole('button', { name: 'Log out', exact: true }).click();
		await expect(reopened).toHaveURL('/login');
		// Even a previously saved cookie must fail after explicit logout revokes its DB session.
		await restarted.addCookies(restored.cookies);
		await reopened.goto('/user/dashboard');
		await expect(reopened).toHaveURL('/login');
	} finally {
		await restarted.close();
	}
});

test('initial permissions wait for a signed-in User, do not capture GPS, and do not repeat on reload', async ({
	page
}) => {
	await installNativeBridge(page);
	await page.goto('/user/login');
	expect((await state(page)).initialRequests).toBe(0);
	await login(page.request, await provision());
	await page.goto('/user/dashboard');
	await expect.poll(async () => (await state(page)).initialRequests).toBe(1);
	expect((await state(page)).gpsChecks).toBe(0);
	expect((await state(page)).overlayStarts).toBe(0);
	await page.reload();
	await expect(
		page.getByRole('button', { name: 'Start SOS for Casey Reyes', exact: true })
	).toBeVisible();
	expect((await state(page)).initialRequests).toBe(0);
	expect((await state(page)).overlayStarts).toBe(0);
});

test('denied initial access leaves dashboard usable and camera can be retried in Settings', async ({
	page
}) => {
	await installNativeBridge(page, { denyInitialPermissions: true });
	await login(page.request, await provision());
	await page.goto('/user/dashboard');
	await expect(page.getByText('Some permissions are unavailable.', { exact: false })).toBeVisible();
	await expect(
		page.getByRole('button', { name: 'Start SOS for Casey Reyes', exact: true })
	).toBeVisible();
	await page.goto('/user/settings');
	await expect(page.getByRole('heading', { name: 'Camera access', exact: true })).toBeVisible();
	await page.evaluate(() => {
		(
			globalThis as unknown as { __handlinkNativeTest: NativeTestState }
		).__handlinkNativeTest.permissionDeny = false;
	});
	await page.getByRole('switch', { name: 'Camera access', exact: true }).click();
	await expect.poll(async () => (await state(page)).cameraPermission).toBe('granted');
	expect((await state(page)).cameraRequests).toBe(1);
});

test('floating switch requests display permission, starts, hides and stops on logout', async ({
	page
}) => {
	await installNativeBridge(page);
	await login(page.request, await provision());
	await page.goto('/user/settings');
	const toggle = page.getByRole('switch', { name: 'Display over other apps', exact: true });
	await expect(toggle).toHaveAttribute('type', 'checkbox');
	await expect(toggle).not.toBeChecked();
	await toggle.click();
	await expect(toggle).toBeChecked();
	expect((await state(page)).overlayAllowed).toBe(true);
	expect((await state(page)).overlayStarts).toBe(1);
	await toggle.click();
	await expect(toggle).not.toBeChecked();
	await toggle.click();
	await expect(toggle).toBeChecked();
	await page.getByRole('button', { name: 'Log out', exact: true }).click();
	await expect(page).toHaveURL('/login');
	expect((await state(page)).overlayActive).toBe(false);
});

test('late overlay permission result cannot leave a floating button after logout', async ({
	page
}) => {
	await installNativeBridge(page);
	await login(page.request, await provision());
	await page.goto('/user/settings');

	await page.evaluate(() => {
		(
			globalThis as unknown as { __handlinkNativeTest: NativeTestState }
		).__handlinkNativeTest.overlayDelay = true;
	});
	await page.getByRole('switch', { name: 'Display over other apps', exact: true }).click();
	await expect.poll(async () => (await state(page)).overlayStarts).toBe(1);
	await page.getByRole('button', { name: 'Log out', exact: true }).click();
	await expect(page).toHaveURL('/login');
	await page.evaluate(() => {
		(
			globalThis as unknown as { __handlinkNativeTest: NativeTestState }
		).__handlinkNativeTest.finishOverlayStart?.();
	});
	await expect.poll(async () => (await state(page)).overlayActive).toBe(false);
});

test('browser Settings includes camera and explains that overlays need Android', async ({
	page
}) => {
	await page.addInitScript(() =>
		localStorage.setItem('handlink:initial-device-permissions:v1', 'attempted')
	);
	await login(page.request, await provision());
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/user/settings');
	await expect(page.getByRole('heading', { name: 'Camera access', exact: true })).toBeVisible();
	await expect(page.getByText('Available in the Android app only.', { exact: true })).toBeVisible();
	await expect(page.getByText('not implemented', { exact: false })).toHaveCount(0);
	const privacyToggle = page.getByRole('button', { name: 'View', exact: true });
	await privacyToggle.click();
	const privacyNotes = page.getByRole('region', { name: 'Privacy and security', exact: true });
	await expect(privacyNotes).toBeVisible();
	const notifications = page.getByRole('region', { name: 'Phone notifications', exact: true });
	for (const width of [390, 1280]) {
		await page.setViewportSize({ width, height: 844 });
		const notesBox = await privacyNotes.boundingBox();
		const notificationsBox = await notifications.boundingBox();
		expect(notesBox).not.toBeNull();
		expect(notificationsBox).not.toBeNull();
		expect(notificationsBox!.y).toBeGreaterThanOrEqual(notesBox!.y + notesBox!.height);
	}
	await page.getByRole('button', { name: 'Close', exact: true }).click();
	await expect(privacyNotes).toHaveCount(0);
	await expect(notifications).toBeVisible();
	await page.setViewportSize({ width: 390, height: 844 });
	await expect(
		page.getByRole('switch', { name: 'Display over other apps', exact: true })
	).toBeDisabled();
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('camera permission check releases all browser camera tracks immediately', async ({ page }) => {
	await page.addInitScript(() => {
		localStorage.setItem('handlink:initial-device-permissions:v1', 'attempted');
		const camera = { stopped: 0, options: null as unknown };
		Object.assign(globalThis, { __permissionCameraTest: camera });
		Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
			value: async (options: MediaStreamConstraints) => {
				camera.options = options;
				return { getTracks: () => [{ stop: () => camera.stopped++ }] };
			}
		});
	});
	await login(page.request, await provision());
	await page.goto('/user/settings');
	await page.getByRole('switch', { name: 'Camera access', exact: true }).click();
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					(globalThis as unknown as { __permissionCameraTest: { stopped: number } })
						.__permissionCameraTest.stopped
			)
		)
		.toBe(1);
	expect(
		await page.evaluate(
			() =>
				(globalThis as unknown as { __permissionCameraTest: { options: unknown } })
					.__permissionCameraTest.options
		)
	).toEqual({ video: true, audio: false });
});

test('permission switches show actual state and open settings when blocked or disabling', async ({
	page
}) => {
	await installNativeBridge(page, { denyInitialPermissions: true });
	await login(page.request, await provision());
	await page.goto('/user/settings');
	const camera = page.getByRole('switch', { name: 'Camera access', exact: true });
	await expect(camera).toHaveAttribute('type', 'checkbox');
	await expect(page.getByRole('switch', { name: 'Location access', exact: true })).toHaveAttribute(
		'type',
		'checkbox'
	);
	await expect(camera).not.toBeChecked();
	await camera.click();
	await expect.poll(async () => (await state(page)).appSettingsOpens).toBe(1);
	await expect(camera).not.toBeChecked();
	await expect(
		page.getByText('Access is still off. Allow camera in Android Settings.', { exact: true })
	).toBeVisible();
	await page.evaluate(() => {
		const device = (globalThis as unknown as { __handlinkNativeTest: NativeTestState })
			.__handlinkNativeTest;
		device.cameraPermission = 'granted';
		window.dispatchEvent(new Event('focus'));
	});
	await expect(camera).toBeChecked();
	await camera.click();
	await expect.poll(async () => (await state(page)).appSettingsOpens).toBe(2);
	await expect(camera).toBeChecked();
	await page.evaluate(() => {
		const device = (globalThis as unknown as { __handlinkNativeTest: NativeTestState })
			.__handlinkNativeTest;
		device.cameraPermission = 'denied';
		window.dispatchEvent(new Event('focus'));
	});
	await expect(camera).not.toBeChecked();
});
