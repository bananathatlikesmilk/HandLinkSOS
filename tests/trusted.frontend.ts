import { expect, test, type Page } from '@playwright/test';
import {
	database,
	headers,
	login,
	origin,
	privateMedical,
	provision,
	sos
} from './incident-fixture';
import { challenge, invitation } from './trusted-fixture';

test('mutual relationship selector offers the matching role instead of contradictory choices', async ({
	page,
	playwright
}) => {
	const owner = await provision();
	const scanner = await provision();
	await login(page.request, owner);
	const other = await playwright.request.newContext({ baseURL: origin });
	try {
		await login(other, scanner);
		const qr = await invitation(page.request, owner.id);
		expect(
			(
				await other.post('/api/trusted/scan', {
					headers,
					data: { token: qr.token, relationship: 'Parent' }
				})
			).status()
		).toBe(201);
		await page.goto('/user/profiles');
		const pending = page.getByRole('article', { name: 'Request from Casey Reyes', exact: true });
		await expect(
			pending.getByText('Their relationship to you: Parent.', { exact: true })
		).toBeVisible();
		await pending
			.getByRole('checkbox', { name: 'Also request permission to send SOS for them' })
			.check();
		const relationship = pending.getByLabel('Your relationship to this person', { exact: true });
		await expect(relationship).toHaveValue('Child');
		await expect(relationship.locator('option:not([disabled])')).toHaveText(['Child']);
		await pending.getByRole('button', { name: 'Approve', exact: true }).click();
		await expect(pending).toHaveCount(0);
		const { connections } = await (await page.request.get('/api/trusted')).json();
		expect(connections).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ relationship: 'Parent', status: 'approved' }),
				expect.objectContaining({ relationship: 'Child', status: 'pending' })
			])
		);
	} finally {
		await other.dispose();
	}
});

async function showQr(page: Page, owner: Awaited<ReturnType<typeof provision>>) {
	let code = '';
	let sent = 0;
	await page.route('**/api/trusted/qr/challenge', async (route) => {
		expect(route.request().postDataJSON()).toEqual({});
		const seeded = challenge(owner.id);
		code = seeded.code;
		sent++;
		await route.fulfill({
			status: 201,
			contentType: 'application/json',
			body: JSON.stringify({ requestId: seeded.requestId, expiresAt: seeded.expiresAt })
		});
	});
	await page.goto('/user/profiles/qr');
	await page.waitForLoadState('networkidle');
	expect(sent).toBe(0);
	await page.getByRole('button', { name: 'Send verification code', exact: true }).click();
	await expect(page.getByText('Verification code sent.', { exact: false })).toBeVisible();
	expect(sent).toBe(1);
	await page.getByLabel('Email verification code', { exact: true }).fill(code);
	const unlocked = page.waitForResponse(
		(response) =>
			response.url().endsWith('/api/trusted/qr') && response.request().method() === 'POST'
	);
	await page.getByRole('button', { name: 'Verify and show QR code', exact: true }).click();
	expect((await unlocked).status()).toBe(201);
	const qr = page.getByRole('img', {
		name: 'Your single-use HandLink trusted profile invitation',
		exact: true
	});
	await expect(qr).toBeVisible();
	const contents = await qr.evaluate((el) => el.outerHTML);
	for (const secret of [owner.email, owner.profileId, privateMedical])
		expect(contents).not.toContain(secret);
	const screenshot = await qr.screenshot();
	await test.info().attach('trusted-profile-qr', { body: screenshot, contentType: 'image/png' });
	return screenshot;
}

test('real QR image requests access; owner approval adds SOS and removal revokes it', async ({
	page,
	browser
}) => {
	test.setTimeout(120000);
	const owner = await provision(),
		requester = await provision();
	await login(page.request, owner);
	await page.setViewportSize({ width: 390, height: 844 });
	const scannerContext = await browser.newContext({
		baseURL: origin,
		viewport: { width: 390, height: 844 }
	});
	const scanner = await scannerContext.newPage();
	try {
		await login(scannerContext.request, requester);
		const png = await showQr(page, owner);
		await scanner.goto('/user/profiles/scan');
		await scanner.waitForLoadState('networkidle');
		await scanner
			.locator('input[type=file]')
			.setInputFiles({ name: 'handlink.png', mimeType: 'image/png', buffer: png });
		await expect(
			scanner.getByRole('heading', { name: 'Invitation found', exact: true })
		).toBeVisible();
		await scanner
			.getByLabel('Your relationship to this person', { exact: true })
			.selectOption('Sibling');
		await scanner.getByRole('button', { name: 'Request trusted access', exact: true }).click();
		await expect(
			scanner.getByRole('heading', { name: 'Request sent to Casey Reyes', exact: true })
		).toBeVisible();
		expect(
			(
				await scanner.request.post('/api/incidents', { headers, data: sos(owner.profileId) })
			).status()
		).toBe(403);
		await page.getByRole('link', { name: 'Back to profiles', exact: true }).click();
		const pending = page.getByRole('article', { name: 'Request from Casey Reyes', exact: true });
		await expect(pending).toBeVisible();
		await pending.getByRole('button', { name: 'Approve', exact: true }).click();
		await expect(pending).toHaveCount(0);
		await scanner.goto('/user/dashboard');
		await expect(
			scanner.getByRole('button', { name: 'Start SOS for Casey Reyes', exact: true })
		).toHaveCount(2);
		expect(
			(await (await page.request.get('/api/incidents/targets')).json()).targets.map((t) => t.id)
		).not.toContain(requester.profileId);
		await scanner.goto('/user/profiles');
		await scanner
			.getByRole('button', { name: 'Remove Casey Reyes from trusted profiles', exact: true })
			.click();
		await scanner
			.getByRole('region', { name: 'Confirm profile removal', exact: true })
			.getByRole('button', { name: 'Remove profile', exact: true })
			.click();
		await expect(
			scanner.getByRole('button', { name: 'Remove Casey Reyes from trusted profiles', exact: true })
		).toHaveCount(0);
		await page.reload();
		await expect(
			page.getByRole('button', { name: "Revoke Casey Reyes's access", exact: true })
		).toHaveCount(0);
		expect(
			(
				await scanner.request.post('/api/incidents', { headers, data: sos(owner.profileId) })
			).status()
		).toBe(403);
		const db = database();
		try {
			expect(
				db
					.prepare(
						'SELECT status FROM trusted_connection WHERE owner_profile_id=? AND requester_profile_id=?'
					)
					.get(owner.profileId, requester.profileId)
			).toMatchObject({ status: 'revoked' });
		} finally {
			db.close();
		}
		for (const current of [page, scanner])
			expect(await current.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
				true
			);
	} finally {
		await scannerContext.close();
	}
});

test('locking a displayed QR invalidates its image; scanner handles unreadable uploads and denied camera', async ({
	page,
	browser
}) => {
	test.setTimeout(90000);
	const owner = await provision(),
		requester = await provision();
	await login(page.request, owner);
	const scannerContext = await browser.newContext({ baseURL: origin });
	const scanner = await scannerContext.newPage();
	try {
		await login(scannerContext.request, requester);
		const png = await showQr(page, owner);
		await page.getByRole('button', { name: 'Hide and lock QR code', exact: true }).click();
		await expect(
			page.getByRole('img', {
				name: 'Your single-use HandLink trusted profile invitation',
				exact: true
			})
		).toHaveCount(0);
		const invalid = await page
			.getByRole('heading', { name: 'My QR code', exact: true })
			.screenshot();
		await scanner.goto('/user/profiles/scan');
		await scanner.waitForLoadState('networkidle');
		await scanner
			.locator('input[type=file]')
			.setInputFiles({ name: 'not-qr.png', mimeType: 'image/png', buffer: invalid });
		await expect(scanner.getByRole('alert')).toContainText('No readable QR code');
		await scanner.getByRole('button', { name: 'Start camera', exact: true }).click();
		await expect(scanner.getByRole('alert')).toContainText('Camera unavailable');
		await scanner
			.locator('input[type=file]')
			.setInputFiles({ name: 'locked.png', mimeType: 'image/png', buffer: png });
		await scanner
			.getByLabel('Your relationship to this person', { exact: true })
			.selectOption('Friend');
		await scanner.getByRole('button', { name: 'Request trusted access', exact: true }).click();
		await expect(scanner.getByRole('alert')).toContainText('already used or locked');
		expect((await (await scanner.request.get('/api/trusted')).json()).connections).toEqual([]);
	} finally {
		await scannerContext.close();
	}
});

test('a live QR scan releases every camera track after decoding', async ({ page, browser }) => {
	test.setTimeout(90000);
	const owner = await provision();
	const requester = await provision();
	await login(page.request, owner);
	const png = await showQr(page, owner);
	const context = await browser.newContext({ baseURL: origin });
	try {
		await login(context.request, requester);
		const scanner = await context.newPage();
		await scanner.addInitScript((imageData) => {
			const tracks: MediaStreamTrack[] = [];
			Object.assign(globalThis, { __qrCameraTracks: tracks });
			Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
				configurable: true,
				value: async () => {
					// Feed the real decoder a real video stream containing a generated invitation.
					const image = new Image();
					image.src = `data:image/png;base64,${imageData}`;
					await image.decode();
					const canvas = document.createElement('canvas');
					canvas.width = image.naturalWidth;
					canvas.height = image.naturalHeight;
					const stream = canvas.captureStream(10);
					canvas.getContext('2d')!.drawImage(image, 0, 0);
					tracks.push(...stream.getTracks());
					return stream;
				}
			});
		}, png.toString('base64'));
		await scanner.goto('/user/profiles/scan');
		await scanner.waitForLoadState('networkidle');
		await scanner.getByRole('button', { name: 'Start camera', exact: true }).click();
		await expect(
			scanner.getByRole('heading', { name: 'Invitation found', exact: true })
		).toBeVisible();
		await expect(scanner.getByText('Camera is off.', { exact: true })).toBeVisible();
		await expect
			.poll(() =>
				scanner.evaluate(() => {
					const tracks = (
						globalThis as typeof globalThis & { __qrCameraTracks: MediaStreamTrack[] }
					).__qrCameraTracks;
					return tracks.length > 0 && tracks.every((track) => track.readyState === 'ended');
				})
			)
			.toBe(true);
		await expect(scanner.locator('video')).toHaveJSProperty('srcObject', null);
	} finally {
		await context.close();
	}
});
