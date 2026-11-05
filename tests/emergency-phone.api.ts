import { expect, test } from '@playwright/test';
import { database, headers, login, origin, provision } from './incident-fixture';
import { installNativeBridge } from './native-fixture';

test('an already-open call screen refreshes Admin changes before opening native dialer and when web regains focus', async ({
	page,
	playwright
}) => {
	test.setTimeout(90000);
	const admin = await playwright.request.newContext({ baseURL: origin });
	const web = await page.context().newPage();
	try {
		await login(admin, await provision('admin'));
		await login(page.request, await provision());
		await web.goto('/user/call');
		await expect(web.getByRole('link', { name: 'Open phone dialer', exact: true })).toHaveAttribute(
			'href',
			'intent:911#Intent;scheme=tel;action=android.intent.action.DIAL;end'
		);
		await installNativeBridge(page);
		await page.goto('/user/call');
		await expect(page.getByText('Open the dialer with 911 ready.', { exact: false })).toBeVisible();
		expect(
			(await admin.put('/api/admin/emergency-phone', { headers, data: { number: '112' } })).status()
		).toBe(200);
		await page.getByRole('button', { name: 'Open phone dialer', exact: true }).click();
		await expect
			.poll(() =>
				page.evaluate(
					() =>
						(globalThis as unknown as { __handlinkNativeTest: { dialedNumbers: string[] } })
							.__handlinkNativeTest.dialedNumbers
				)
			)
			.toEqual(['112']);
		await expect(page.getByRole('status')).toContainText('Phone dialer opened with 112 filled in.');
		await web.evaluate(() => window.dispatchEvent(new Event('focus')));
		await expect(web.getByRole('link', { name: 'Open phone dialer', exact: true })).toHaveAttribute(
			'href',
			'intent:112#Intent;scheme=tel;action=android.intent.action.DIAL;end'
		);
		expect(
			(
				await admin.put('/api/admin/emergency-phone', {
					headers,
					data: { number: '+639181234567' }
				})
			).status()
		).toBe(200);
		await page.route('**/api/emergency-phone', (route) => route.abort());
		await page.getByRole('button', { name: 'Open phone dialer', exact: true }).click();
		await expect(page.getByRole('alert')).toContainText('Could not verify the current hotline');
		expect(
			await page.evaluate(
				() =>
					(globalThis as unknown as { __handlinkNativeTest: { dialedNumbers: string[] } })
						.__handlinkNativeTest.dialedNumbers
			)
		).toEqual(['112']);
		await page.unroute('**/api/emergency-phone');
		await page.getByRole('button', { name: 'Open phone dialer', exact: true }).click();
		await expect
			.poll(() =>
				page.evaluate(
					() =>
						(globalThis as unknown as { __handlinkNativeTest: { dialedNumbers: string[] } })
							.__handlinkNativeTest.dialedNumbers
				)
			)
			.toEqual(['112', '+639181234567']);
		await web.route('**/api/emergency-phone', (route) => route.abort());
		await web.getByRole('link', { name: 'Open phone dialer', exact: true }).click();
		await expect(web.getByRole('alert')).toContainText('Could not verify the current hotline');
	} finally {
		const db = database();
		try {
			db.prepare('DELETE FROM emergency_phone_setting').run();
		} finally {
			db.close();
		}
		await web.close();
		await admin.dispose();
	}
});

test('central Admin configures a persistent SOS number; browser and native dialers use it without placing calls', async ({
	page,
	playwright
}) => {
	test.setTimeout(180000);
	const endpoint = '/api/admin/emergency-phone';
	expect((await page.request.get(endpoint)).status()).toBe(401);
	const admin = await provision('admin');
	await login(page.request, admin);
	expect(await (await page.request.get(endpoint)).json()).toEqual({ number: '911' });
	const local = await provision('admin');
	const dispatcher = await provision('dispatcher');
	const caller = await provision();
	const db = database();
	try {
		db.prepare('INSERT INTO staff_lgu (user_id,lgu_id) VALUES (?,?)').run(local.id, 'legacy');
	} finally {
		db.close();
	}
	const [localApi, staffApi, user] = await Promise.all(
		[0, 1, 2].map(() => playwright.request.newContext({ baseURL: origin }))
	);
	try {
		await login(localApi, local);
		await login(staffApi, dispatcher);
		await login(user, caller);
		for (const client of [localApi, staffApi, user]) {
			expect((await client.get(endpoint)).status()).toBe(403);
			expect((await client.put(endpoint, { headers, data: { number: '112' } })).status()).toBe(403);
		}
		expect((await page.request.put(endpoint, { data: { number: '112' } })).status()).toBe(403);
		for (const number of [
			'',
			'12',
			'1234567890123456',
			'+12',
			'tel:911',
			'911#Intent;end',
			'*123#',
			'911,123',
			'911 ext 2',
			'abc'
		])
			expect((await page.request.put(endpoint, { headers, data: { number } })).status()).toBe(422);
		expect(
			(
				await page.request.put(endpoint, { headers, data: { number: '112', role: 'admin' } })
			).status()
		).toBe(422);
		await page.goto('/admin/emergency-phone');
		await page.getByLabel('SOS phone number *', { exact: true }).fill('+639171234567');
		await page.getByRole('button', { name: 'Save SOS phone number', exact: true }).click();
		await expect(page.getByRole('status')).toContainText('SOS phone number saved');
		await page.reload();
		await expect(page.getByLabel('SOS phone number *', { exact: true })).toHaveValue(
			'+639171234567'
		);
		const saved = database();
		try {
			expect(
				saved.prepare('SELECT number,updated_by_user_id FROM emergency_phone_setting').get()
			).toEqual({ number: '+639171234567', updated_by_user_id: admin.id });
		} finally {
			saved.close();
		}
		await login(page.request, caller);
		await page.goto('/user/call');
		await expect(
			page.getByRole('link', { name: 'Open phone dialer', exact: true })
		).toHaveAttribute(
			'href',
			'intent:+639171234567#Intent;scheme=tel;action=android.intent.action.DIAL;end'
		);
		await expect(
			page.getByText('Open the dialer with +639171234567 ready.', { exact: false })
		).toBeVisible();
		await installNativeBridge(page);
		await page.goto('/user/call');
		await page.getByRole('button', { name: 'Open phone dialer', exact: true }).click();
		expect(
			await page.evaluate(
				() =>
					(globalThis as unknown as { __handlinkNativeTest: { dialedNumbers: string[] } })
						.__handlinkNativeTest.dialedNumbers
			)
		).toEqual(['+639171234567']);
		// The actual SOS path must use the saved number after the incident is persisted.
		await page.goto(`/user/sos?profile=${caller.profileId}`);
		await expect(page.getByRole('heading', { name: 'SOS sent', exact: true })).toBeVisible({
			timeout: 15000
		});
		await expect
			.poll(() =>
				page.evaluate(
					() =>
						(globalThis as unknown as { __handlinkNativeTest: { dialedNumbers: string[] } })
							.__handlinkNativeTest.dialedNumbers
				)
			)
			.toEqual(['+639171234567']);
		await page.reload();
		expect(
			await page.evaluate(
				() =>
					(globalThis as unknown as { __handlinkNativeTest: { dialedNumbers: string[] } })
						.__handlinkNativeTest.dialedNumbers
			)
		).toEqual([]);
	} finally {
		const cleanup = database();
		try {
			cleanup.prepare('DELETE FROM emergency_phone_setting').run();
		} finally {
			cleanup.close();
		}
		for (const client of [localApi, staffApi, user]) await client.dispose();
	}
});

test('legacy APK never opens its hardcoded number when a custom SOS number is configured', async ({
	page
}) => {
	const admin = await provision('admin');
	await login(page.request, admin);
	const endpoint = '/api/admin/emergency-phone';
	expect((await page.request.put(endpoint, { headers, data: { number: '112' } })).status()).toBe(
		200
	);
	try {
		await login(page.request, await provision());
		await installNativeBridge(page, { legacyPhone: true });
		await page.goto('/user/call');
		await page.getByRole('button', { name: 'Open phone dialer', exact: true }).click();
		await expect(page.getByRole('alert')).toBeVisible();
		expect(
			await page.evaluate(
				() =>
					(globalThis as unknown as { __handlinkNativeTest: { dialerAttempts: number } })
						.__handlinkNativeTest.dialerAttempts
			)
		).toBe(0);
	} finally {
		const cleanup = database();
		try {
			cleanup.prepare('DELETE FROM emergency_phone_setting').run();
		} finally {
			cleanup.close();
		}
	}
});
