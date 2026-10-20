import { expect, test } from '@playwright/test';
import { installNativeBridge, type NativeTestState } from './native-fixture';
import {
	database,
	headers,
	login,
	origin,
	privateMedical,
	provision,
	sos
} from './incident-fixture';

test('another dispatcher sees no report while admin can read it without status controls', async ({
	page,
	request,
	playwright
}) => {
	test.setTimeout(90000);
	const caller = await provision();
	await login(request, caller);
	const response = await request.post('/api/incidents', { headers, data: sos(caller.profileId) });
	const { id, reference } = (await response.json()).incident;
	const owner = await provision('dispatcher');
	const ownerContext = await playwright.request.newContext({ baseURL: origin });
	try {
		await login(ownerContext, owner);
		expect(
			(
				await ownerContext.post(`/api/staff/incidents/${id}/confirm`, {
					headers,
					data: { verballyConfirmed: true }
				})
			).status()
		).toBe(200);
		const other = await provision('dispatcher');
		await login(page.request, other);
		await page.goto('/dispatch/reports');
		await page.waitForLoadState('networkidle');
		await expect(
			page.getByRole('heading', { name: 'Incident reports', exact: true })
		).toBeVisible();
		await expect(page.getByText(id, { exact: false })).toHaveCount(0);
		await expect(page.getByText(reference, { exact: false })).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'Mark on route', exact: true })).toHaveCount(0);
		expect((await page.request.get(`/api/staff/reports/${id}`)).status()).toBe(404);
		const admin = await provision('admin');
		await login(page.request, admin);
		await page.goto('/admin/reports');
		await page.waitForLoadState('networkidle');
		await expect(page.getByRole('button').filter({ hasText: reference })).toBeVisible();
		await page.getByRole('button').filter({ hasText: reference }).click();
		await expect(page.getByText(id, { exact: false })).toHaveCount(0);
		await expect(page.getByText('Casey Reyes', { exact: true }).first()).toBeVisible();
		await expect(page.getByRole('button', { name: 'Mark on route', exact: true })).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'Mark resolved', exact: true })).toHaveCount(0);
	} finally {
		await ownerContext.dispose();
	}
});

test('cancel sends nothing; a real SOS reaches dispatcher confirmation and resolution', async ({
	page,
	browser
}) => {
	test.setTimeout(120000);
	const caller = await provision();
	const handler = await provision('dispatcher');
	await login(page.request, caller);
	await page.context().grantPermissions(['geolocation']);
	await page.context().setGeolocation({ latitude: 14.5995, longitude: 120.9842 });
	await page.setViewportSize({ width: 390, height: 844 });
	const staffContext = await browser.newContext({ baseURL: origin });
	const staff = await staffContext.newPage();
	try {
		await login(staffContext.request, handler);
		await staff.goto('/dispatch');
		await expect(
			staff.getByRole('heading', { name: 'SOS alerts', exact: true }).first()
		).toBeVisible();
		await page.goto('/user/dashboard');
		const start = page.getByRole('button', { name: 'Start SOS for Casey Reyes', exact: true });
		await expect(start).toBeEnabled();
		await start.click();
		await expect(page.getByRole('timer')).toBeVisible();
		await page.getByRole('button', { name: 'Cancel SOS', exact: true }).click();
		await expect(page.getByRole('heading', { name: 'SOS cancelled', exact: true })).toBeVisible();
		await expect(page).toHaveURL(/\/user\/sos\?/);
		// Wait beyond the original deadline to prove cancellation stops submission.
		await page.waitForTimeout(5500);
		const db = database();
		try {
			expect(
				db.prepare('SELECT count(*) AS n FROM incident WHERE caller_user_id=?').get(caller.id)
			).toMatchObject({ n: 0 });
		} finally {
			db.close();
		}
		await page.getByRole('link', { name: 'Back to dashboard', exact: true }).click();
		await expect(start).toBeEnabled();
		await start.click();
		await expect(page).toHaveURL(/\/user\/call\?incident=/, {
			timeout: 15000
		});
		await expect(page.getByRole('heading', { name: 'SOS sent', exact: true })).toBeVisible();
		await expect(
			page.getByRole('link', { name: 'Open phone dialer', exact: true })
		).toHaveAttribute('href', 'intent:911#Intent;scheme=tel;action=android.intent.action.DIAL;end');
		const own = await (await page.request.get('/api/incidents')).json();
		expect(own.incidents).toHaveLength(1);
		const { id, reference } = own.incidents[0];
		await expect(page).toHaveURL(`/user/call?incident=${id}`);
		expect(reference).toMatch(/^HL-\d{7,}$/);
		await expect(page.getByText(reference, { exact: false }).first()).toBeVisible();
		await expect(page.getByText(id, { exact: false })).toHaveCount(0);
		// The open staff queue must receive the new row without manual reload.
		const alert = staff.getByRole('button').filter({ hasText: reference });
		await expect(alert).toBeVisible({ timeout: 12000 });
		await staff.getByRole('textbox', { name: 'Search incidents', exact: true }).fill(reference);
		const searched = staff.waitForResponse(
			(response) =>
				response.url().includes('/api/staff/incidents?') &&
				new URL(response.url()).searchParams.get('search') === reference
		);
		await staff.getByRole('button', { name: 'Search alerts', exact: true }).click();
		expect((await searched).ok()).toBe(true);
		await expect(alert).toBeVisible();
		await alert.click();
		const confirm = staff.getByRole('button', { name: 'Confirm incident', exact: true });
		await expect(confirm).toBeDisabled();
		await expect(staff.getByText(privateMedical, { exact: true })).toHaveCount(0);
		await staff.getByRole('checkbox', { name: /I verbally confirmed/ }).check();
		const checkboxBounds = await staff
			.getByRole('checkbox', { name: /I verbally confirmed/ })
			.boundingBox();
		const confirmBounds = await confirm.boundingBox();
		expect(confirmBounds!.y).toBeGreaterThan(checkboxBounds!.y);
		await confirm.click();
		await staff.getByRole('button', { name: 'Medical information', exact: true }).click();
		await expect(staff.getByText(privateMedical, { exact: true })).toBeVisible();
		await staff.getByRole('button', { name: 'Additional information', exact: true }).click();
		await staff
			.getByRole('textbox', { name: 'Additional information', exact: true })
			.fill('Caller reports chest pain.');
		await expect(staff.getByText('Notes saved', { exact: true })).toBeVisible();
		await staff.goto('/dispatch/reports');
		await expect(
			staff.getByRole('heading', { name: 'Incident reports', exact: true })
		).toBeVisible();
		await expect(staff.getByText('Caller reports chest pain.', { exact: true })).toBeVisible();
		await staff.getByRole('button', { name: 'Mark on route', exact: true }).click();
		await expect(staff.getByRole('button', { name: 'Mark resolved', exact: true })).toBeEnabled();
		await staff.getByRole('button', { name: 'Mark resolved', exact: true }).click();
		await expect(staff.getByText('Incident marked resolved.', { exact: true })).toBeVisible();
		await staff.reload();
		await expect(staff.getByText('Caller reports chest pain.', { exact: true })).toBeVisible();
		await expect(staff.getByRole('button', { name: 'Mark on route', exact: true })).toBeDisabled();
		await expect(staff.getByRole('button', { name: 'Mark resolved', exact: true })).toBeDisabled();
		await staff
			.getByRole('textbox', { name: 'Addendum', exact: false })
			.fill('Caller confirmed safe after follow-up.');
		let lostAddendumResponse = false;
		await staff.route(`**/api/staff/reports/${id}/addenda`, async (route) => {
			if (!lostAddendumResponse) {
				lostAddendumResponse = true;
				const saved = await route.fetch();
				expect(saved.ok()).toBe(true);
				await route.abort('failed');
			} else await route.continue();
		});
		await staff.getByRole('button', { name: 'Save addendum', exact: true }).click();
		await expect(staff.getByRole('alert')).toBeVisible();
		await expect(staff.getByRole('textbox', { name: 'Addendum', exact: false })).toHaveValue(
			'Caller confirmed safe after follow-up.'
		);
		await staff.getByRole('button', { name: 'Save addendum', exact: true }).click();
		await expect(
			staff.getByText('Addendum saved. Original notes kept.', { exact: true })
		).toBeVisible();
		await expect(
			staff.getByText('Caller confirmed safe after follow-up.', { exact: true })
		).toHaveCount(1);
		await expect(staff.getByText('Caller reports chest pain.', { exact: true })).toBeVisible();
		const report = await (await staff.request.get(`/api/staff/reports/${id}`)).json();
		expect(report.addenda).toHaveLength(1);
		expect(report.notes).toBe('Caller reports chest pain.');
		await page.goto('/user/dashboard');
		await expect(page.getByText('Resolved', { exact: true })).toBeVisible();
		await page.reload();
		await expect(page.getByText(reference, { exact: false })).toBeVisible();
		await expect(page.getByText(id, { exact: false })).toHaveCount(0);
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
			true
		);
	} finally {
		await staffContext.close();
	}
});

test('dispatcher autosave preserves newer typing, rejects stale edits and flushes before navigation', async ({
	page,
	request
}) => {
	test.setTimeout(60000);
	const caller = await provision();
	await login(request, caller);
	const created = await request.post('/api/incidents', { headers, data: sos(caller.profileId) });
	const { id, reference } = (await created.json()).incident;
	await login(page.request, await provision('dispatcher'));
	expect(
		(
			await page.request.post(`/api/staff/incidents/${id}/confirm`, {
				headers,
				data: { verballyConfirmed: true }
			})
		).ok()
	).toBe(true);
	await page.goto('/dispatch');
	await page.getByRole('button').filter({ hasText: reference }).click();
	await page.getByRole('button', { name: 'Additional information', exact: true }).click();
	const notes = page.getByRole('textbox', { name: 'Additional information', exact: true });
	let releaseSave!: () => void;
	const saveGate = new Promise<void>((resolve) => {
		releaseSave = resolve;
	});
	let delayed = false;
	await page.route(`**/api/staff/incidents/${id}/notes`, async (route) => {
		if (!delayed) {
			delayed = true;
			const response = await route.fetch();
			await saveGate;
			await route.fulfill({ response });
		} else await route.continue();
	});
	await notes.fill('First note.');
	await expect(page.getByText('Saving notes...', { exact: true })).toBeVisible();
	await notes.fill('Newer note typed while saving.');
	await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
	await expect(notes).toHaveValue('Newer note typed while saving.');
	await expect(page.getByRole('button', { name: 'Mark on route', exact: true })).toBeDisabled();
	releaseSave();
	await expect(page.getByText('Notes saved', { exact: true })).toBeVisible();
	await expect(notes).toHaveValue('Newer note typed while saving.');
	expect((await (await page.request.get(`/api/staff/incidents/${id}`)).json()).notes).toBe(
		'Newer note typed while saving.'
	);
	await notes.fill('Unsaved local draft.');
	expect(
		(
			await page.request.post(`/api/staff/incidents/${id}/notes`, {
				headers,
				data: { notes: 'Other tab saved this.' }
			})
		).ok()
	).toBe(true);
	await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
	await expect(notes).toHaveValue('Unsaved local draft.');
	await expect(
		page.getByRole('alert').filter({ hasText: 'Notes changed elsewhere' })
	).toBeVisible();
	await expect(notes).toHaveValue('Unsaved local draft.');
	await expect(page.getByRole('button', { name: 'Mark on route', exact: true })).toBeDisabled();
	page.once('dialog', (dialog) => dialog.accept());
	await page.getByRole('button', { name: 'Reload saved notes', exact: true }).click();
	await expect(notes).toHaveValue('Other tab saved this.');
	await notes.fill('Final note before navigating.');
	await page.getByRole('link', { name: 'Incident reports', exact: true }).click();
	await expect(page).toHaveURL('/dispatch/reports');
	await expect(page.getByText('Final note before navigating.', { exact: true })).toBeVisible();
});

test('lost SOS response can retry after reload without a duplicate incident', async ({ page }) => {
	test.setTimeout(90000);
	const caller = await provision();
	await login(page.request, caller);
	await page.context().grantPermissions(['geolocation']);
	await page.context().setGeolocation({ latitude: 14.5995, longitude: 120.9842 });
	let intercepted = false;
	await page.route('**/api/incidents', async (route) => {
		if (route.request().method() === 'POST' && !intercepted) {
			intercepted = true;
			const accepted = await route.fetch();
			expect(accepted.status()).toBe(201);
			await route.abort('failed');
		} else await route.continue();
	});
	await page.goto(`/user/sos?profile=${caller.profileId}`);
	await expect(
		page.getByRole('button', { name: 'Retry saved SOS request', exact: true })
	).toBeVisible({ timeout: 15000 });
	await page.reload();
	await page.getByRole('button', { name: 'Retry saved SOS request', exact: true }).click();
	await expect(page).toHaveURL(/\/user\/call\?incident=/);
	await expect(page.getByRole('heading', { name: 'SOS sent', exact: true })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Open phone dialer', exact: true })).toHaveAttribute(
		'href',
		'intent:911#Intent;scheme=tel;action=android.intent.action.DIAL;end'
	);
	const db = database();
	try {
		expect(
			db.prepare('SELECT count(*) AS n FROM incident WHERE caller_user_id=?').get(caller.id)
		).toMatchObject({ n: 1 });
		expect(
			db
				.prepare(
					"SELECT count(*) AS n FROM incident_event WHERE actor_user_id=? AND type='created'"
				)
				.get(caller.id)
		).toMatchObject({ n: 1 });
	} finally {
		db.close();
	}
});

test('phone help without a confirmed incident never claims SOS was sent', async ({ page }) => {
	await login(page.request, await provision());
	await page.goto('/user/call');
	await expect(
		page.getByRole('heading', { name: 'Call through your phone', exact: true })
	).toBeVisible();
	await expect(page.getByRole('heading', { name: 'SOS sent', exact: true })).toHaveCount(0);
	await expect(page.getByRole('link', { name: 'Open phone dialer', exact: true })).toHaveAttribute(
		'href',
		'intent:911#Intent;scheme=tel;action=android.intent.action.DIAL;end'
	);
	await expect(page.getByText(/Incident reference:/)).toHaveCount(0);
});

test('denied location never starts a countdown or submits SOS', async ({ page }) => {
	const caller = await provision();
	await login(page.request, caller);
	await page.context().clearPermissions();
	await page.goto(`/user/sos?profile=${caller.profileId}`);
	await expect(page.getByRole('heading', { name: 'SOS needs attention', exact: true })).toBeVisible(
		{ timeout: 20000 }
	);
	await expect(page.getByRole('button', { name: 'Retry location', exact: true })).toBeVisible();
	const db = database();
	try {
		expect(
			db.prepare('SELECT count(*) AS n FROM incident WHERE caller_user_id=?').get(caller.id)
		).toMatchObject({ n: 0 });
	} finally {
		db.close();
	}
});

test('Android opens the 911 dialer only after saved SOS; cancellation and refresh never launch it', async ({
	page
}) => {
	test.setTimeout(60000);
	const caller = await provision();
	await login(page.request, caller);
	await installNativeBridge(page);
	const attempts = () =>
		page.evaluate(
			() =>
				(globalThis as unknown as { __handlinkNativeTest: NativeTestState }).__handlinkNativeTest
					.dialerAttempts
		);
	await page.goto(`/user/sos?profile=${caller.profileId}`);
	await page.getByRole('button', { name: 'Cancel SOS', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'SOS cancelled', exact: true })).toBeVisible();
	expect(await attempts()).toBe(0);
	await page.getByRole('link', { name: 'Back to dashboard', exact: true }).click();
	await page.getByRole('button', { name: 'Start SOS for Casey Reyes', exact: true }).click();
	await expect(page).toHaveURL(/\/user\/call\?incident=/, { timeout: 15000 });
	await expect.poll(attempts).toBe(1);
	const own = (await (await page.request.get('/api/incidents')).json()).incidents;
	expect(own).toHaveLength(1);
	await expect(
		page.getByText(`Incident reference: ${own[0].reference}`, { exact: true })
	).toBeVisible();
	await page.reload();
	await expect(page.getByRole('button', { name: 'Open phone dialer', exact: true })).toBeVisible();
	expect(await attempts()).toBe(0);
	await page.getByRole('button', { name: 'Open phone dialer', exact: true }).click();
	await expect.poll(attempts).toBe(1);
});

test('web never opens phone links automatically and offers only an explicit Android dial action', async ({
	page
}) => {
	await page.context().grantPermissions(['geolocation']);
	await page.context().setGeolocation({ latitude: 14.5995, longitude: 120.9842, accuracy: 10 });
	const caller = await provision();
	await login(page.request, caller);
	await page.addInitScript(() => {
		const state = globalThis as unknown as { __dialerRequests: string[] };
		state.__dialerRequests = [];
		const originalClick = HTMLAnchorElement.prototype.click;
		HTMLAnchorElement.prototype.click = function () {
			// Intercept external phone links: tests must never launch a real emergency call.
			if (this.protocol === 'tel:' || this.protocol === 'intent:') {
				state.__dialerRequests.push(this.href);
				return;
			}
			originalClick.call(this);
		};
	});
	const attempts = () =>
		page.evaluate(() => (globalThis as unknown as { __dialerRequests: string[] }).__dialerRequests);
	await page.goto(`/user/sos?profile=${caller.profileId}`);
	await page.getByRole('button', { name: 'Cancel SOS', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'SOS cancelled', exact: true })).toBeVisible();
	expect(await attempts()).toEqual([]);
	await page.getByRole('link', { name: 'Back to dashboard', exact: true }).click();
	await page.getByRole('button', { name: 'Start SOS for Casey Reyes', exact: true }).click();
	await expect(page).toHaveURL(/\/user\/call\?incident=/, { timeout: 15000 });
	expect(await attempts()).toEqual([]);
	await expect(page.getByRole('main').getByRole('status')).toHaveCount(0);
	await expect(page.getByRole('link', { name: 'Open phone dialer', exact: true })).toHaveAttribute(
		'href',
		'intent:911#Intent;scheme=tel;action=android.intent.action.DIAL;end'
	);
	expect((await (await page.request.get('/api/incidents')).json()).incidents).toHaveLength(1);
	await page.reload();
	await expect(page.getByRole('heading', { name: 'SOS sent', exact: true })).toBeVisible();
	expect(await attempts()).toEqual([]);
});

test('native dialer failure keeps SOS saved and allows a manual retry', async ({ page }) => {
	test.setTimeout(45000);
	const caller = await provision();
	await login(page.request, caller);
	await installNativeBridge(page);
	await page.goto(`/user/sos?profile=${caller.profileId}`);
	await expect(page.getByRole('timer')).toBeVisible();
	await page.evaluate(() => {
		(
			globalThis as unknown as { __handlinkNativeTest: NativeTestState }
		).__handlinkNativeTest.denyDialer = true;
	});
	await expect(page.getByRole('heading', { name: 'SOS sent', exact: true })).toBeVisible({
		timeout: 15000
	});
	await expect(page.getByRole('alert')).toContainText('Your SOS remains saved.');
	expect((await (await page.request.get('/api/incidents')).json()).incidents).toHaveLength(1);
	await page.evaluate(() => {
		(
			globalThis as unknown as { __handlinkNativeTest: NativeTestState }
		).__handlinkNativeTest.denyDialer = false;
	});
	await page.getByRole('button', { name: 'Open phone dialer', exact: true }).click();
	await expect(page.getByRole('status')).toContainText('Phone dialer opened with 911 filled in.');
	await expect(page.getByRole('alert')).toHaveCount(0);
});

test('call handoff loader validates IDs and hides another caller incident', async ({ page }) => {
	const caller = await provision();
	await login(page.request, caller);
	const created = await page.request.post('/api/incidents', {
		headers,
		data: sos(caller.profileId)
	});
	expect(created.status()).toBe(201);
	const { id } = (await created.json()).incident;
	expect((await page.goto(`/user/call?incident=${id}`))?.status()).toBe(200);
	expect((await page.goto('/user/call?incident=bad-id'))?.status()).toBe(400);
	await login(page.request, await provision());
	expect((await page.goto(`/user/call?incident=${id}`))?.status()).toBe(404);
	await expect(page.getByRole('heading', { name: 'SOS sent', exact: true })).toHaveCount(0);
});
