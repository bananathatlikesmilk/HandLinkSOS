import { expect, test, type Page } from '@playwright/test';
import { login, provision } from './incident-fixture';
import { installNativeBridge, type NativeTestState } from './native-fixture';

const state = (page: Page) =>
	page.evaluate(
		() => (globalThis as unknown as { __handlinkNativeTest: NativeTestState }).__handlinkNativeTest
	);

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
	await page.getByRole('button', { name: 'Allow camera', exact: true }).click();
	await expect.poll(async () => (await state(page)).cameraPermission).toBe('granted');
	expect((await state(page)).cameraRequests).toBe(1);
});

test('overlay needs separate display permission and explicit enable; hide and logout stop it', async ({
	page
}) => {
	await installNativeBridge(page);
	await login(page.request, await provision());
	await page.goto('/user/settings');
	await expect(
		page.getByRole('button', { name: 'Enable floating button', exact: true })
	).toBeDisabled();
	await page.getByRole('button', { name: 'Allow display over apps', exact: true }).click();
	await expect(
		page.getByRole('button', { name: 'Enable floating button', exact: true })
	).toBeEnabled();
	expect((await state(page)).overlayStarts).toBe(0);
	await page.getByRole('button', { name: 'Enable floating button', exact: true }).click();
	await expect(
		page.getByRole('button', { name: 'Hide floating button', exact: true })
	).toBeVisible();
	await page.getByRole('button', { name: 'Hide floating button', exact: true }).click();
	await expect.poll(async () => (await state(page)).overlayActive).toBe(false);
	await page.getByRole('button', { name: 'Enable floating button', exact: true }).click();
	await expect(
		page.getByRole('button', { name: 'Hide floating button', exact: true })
	).toBeVisible();
	await page.getByRole('button', { name: 'Log out', exact: true }).click();
	await expect(page).toHaveURL('/user/login');
	expect((await state(page)).overlayActive).toBe(false);
});

test('late overlay permission result cannot leave a floating button after logout', async ({
	page
}) => {
	await installNativeBridge(page);
	await login(page.request, await provision());
	await page.goto('/user/settings');
	await page.getByRole('button', { name: 'Allow display over apps', exact: true }).click();
	await page.evaluate(() => {
		(
			globalThis as unknown as { __handlinkNativeTest: NativeTestState }
		).__handlinkNativeTest.overlayDelay = true;
	});
	await page.getByRole('button', { name: 'Enable floating button', exact: true }).click();
	await expect.poll(async () => (await state(page)).overlayStarts).toBe(1);
	await page.getByRole('button', { name: 'Log out', exact: true }).click();
	await expect(page).toHaveURL('/user/login');
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
	await expect(
		page.getByRole('button', { name: 'Enable floating button', exact: true })
	).toHaveCount(0);
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
	await page.getByRole('button', { name: 'Allow camera', exact: true }).click();
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
