import { expect, test, type Page } from '@playwright/test';
import { database, headers, login, origin, privateMedical, provision } from './incident-fixture';

const endpoint = '/api/staff/incidents/unclaimed';
async function provincialStaff() {
	const actor = await provision('dispatcher');
	const db = database();
	try {
		db.prepare('INSERT INTO staff_lgu (user_id,lgu_id) VALUES (?,?)').run(
			actor.id,
			'provincial-intake'
		);
	} finally {
		db.close();
	}
	return actor;
}
async function isolatedStaff() {
	const actor = await provision('dispatcher');
	const lguId = crypto.randomUUID();
	const db = database();
	try {
		db.prepare('INSERT INTO lgu (id,name,active) VALUES (?,?,1)').run(
			lguId,
			`Unclaimed test ${lguId}`
		);
		db.prepare('INSERT INTO staff_lgu (user_id,lgu_id) VALUES (?,?)').run(actor.id, lguId);
	} finally {
		db.close();
	}
	return { ...actor, lguId };
}
function addIncident(
	caller: Awaited<ReturnType<typeof provision>>,
	lguId = 'provincial-intake',
	age = 65000
) {
	const id = crypto.randomUUID();
	const db = database();
	try {
		db.prepare(
			'INSERT INTO incident (id,person_profile_id,caller_user_id,caller_name,latitude,longitude,idempotency_key,created_at) VALUES (?,?,?,?,?,?,?,?)'
		).run(
			id,
			caller.profileId,
			caller.id,
			'Synthetic reporter',
			14,
			121,
			crypto.randomUUID(),
			Date.now() - age
		);
		db.prepare('INSERT INTO incident_lgu (incident_id,lgu_id,reason) VALUES (?,?,?)').run(
			id,
			lguId,
			'provincial_intake'
		);
		return {
			id,
			reference: db
				.prepare(
					"SELECT 'HL-' || printf('%07d',number) AS reference FROM incident_reference WHERE incident_id=?"
				)
				.get(id) as { reference: string }
		};
	} finally {
		db.close();
	}
}
async function installSound(page: Page) {
	await page.addInitScript(() => {
		const state = { starts: 0, closed: 0, state: 'suspended' };
		Object.assign(globalThis, { __warningAudio: state });
		Object.defineProperty(window, 'AudioContext', {
			configurable: true,
			value: class {
				get state() {
					return state.state;
				}
				currentTime = 0;
				destination = {};
				resume() {
					state.state = 'running';
					return Promise.resolve();
				}
				close() {
					state.state = 'closed';
					state.closed++;
					return Promise.resolve();
				}
				createOscillator() {
					return {
						type: 'sine',
						frequency: { setValueAtTime() {} },
						onended: null as (() => void) | null,
						connect() {},
						disconnect() {},
						start() {
							state.starts++;
						},
						stop() {
							this.onended?.();
						}
					};
				}
				createGain() {
					return {
						gain: { setValueAtTime() {}, linearRampToValueAtTime() {} },
						connect() {},
						disconnect() {}
					};
				}
			}
		});
	});
}
async function soundCount(page: Page) {
	return page.evaluate(
		() =>
			(globalThis as typeof globalThis & { __warningAudio: { starts: number } }).__warningAudio
				.starts
	);
}
async function refreshWarning(page: Page, count: number) {
	await expect
		.poll(async () => {
			await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
			return page.getByRole('region', { name: 'Unclaimed SOS alerts' }).textContent();
		})
		.toContain(`${count} ${count === 1 ? 'alert' : 'alerts'} waiting`);
}

test('unclaimed summary enforces dispatcher/MFA/LGU scope and includes all pages without personal details', async ({
	request,
	playwright
}) => {
	test.setTimeout(120000);
	expect((await request.get(endpoint)).status()).toBe(401);
	const caller = await provision();
	await login(request, caller);
	expect((await request.get(endpoint)).status()).toBe(403);
	const central = await playwright.request.newContext({ baseURL: origin });
	const municipal = await playwright.request.newContext({ baseURL: origin });
	const province = await playwright.request.newContext({ baseURL: origin });
	try {
		await login(central, await provision('admin'));
		expect((await central.get(endpoint)).status()).toBe(403);
		const actor = await provincialStaff();
		await login(province, actor, false);
		expect((await province.get(endpoint)).status()).toBe(403);
		// Complete MFA using the fixture's normal enrollment flow.
		const { enrollStaffMfa } = await import('./mfa-fixture');
		const { password } = await import('./incident-fixture');
		await enrollStaffMfa(province, password);
		await login(municipal, await provision('dispatcher'));
		const oldest = addIncident(caller, 'provincial-intake', 120000);
		for (let i = 0; i < 24; i++) addIncident(caller);
		addIncident(caller, 'legacy');
		addIncident(caller, 'legacy');
		const response = await province.get(endpoint + '?search=no-match&status=Resolved&page=2');
		expect(response.headers()['cache-control']).toContain('no-store');
		const summary = await response.json();
		expect(summary).toMatchObject({
			count: 25,
			oldest: { id: oldest.id, reference: oldest.reference.reference }
		});
		expect(typeof summary.newestReferenceNumber).toBe('string');
		expect(BigInt(summary.newestReferenceNumber)).toBeGreaterThan(0n);
		expect(Object.keys(summary.oldest).sort()).toEqual(['id', 'reference', 'startedAt']);
		expect(JSON.stringify(summary)).not.toContain(privateMedical);
		expect(JSON.stringify(summary)).not.toContain('Synthetic reporter');
		expect((await (await municipal.get(endpoint)).json()).count).toBe(2);
		expect(
			(
				await province.post(`/api/staff/incidents/${oldest.id}/confirm`, {
					headers,
					data: { verballyConfirmed: true }
				})
			).status()
		).toBe(200);
		const next = await (await province.get(endpoint)).json();
		expect(next.count).toBe(24);
		expect(next.oldest.id).not.toBe(oldest.id);
	} finally {
		await central.dispose();
		await municipal.dispose();
		await province.dispose();
	}
});

test('unclaimed timer ignores filters; sound requires enable, acknowledgment does not claim, and new arrivals re-arm sound', async ({
	page
}) => {
	test.setTimeout(90000);
	await installSound(page);
	const actor = await isolatedStaff();
	await login(page.request, actor);
	const caller = await provision();
	addIncident(caller, actor.lguId);
	addIncident(caller, actor.lguId);
	await page.clock.install();
	await page.goto('/dispatch');
	const warning = page.getByRole('region', { name: 'Unclaimed SOS alerts' });
	await expect(warning).toContainText('2 alerts waiting');
	await expect(warning).toContainText(/Waiting 1m/);
	expect(await soundCount(page)).toBe(0);
	await page
		.getByRole('combobox', { name: 'Filter incidents', exact: true })
		.selectOption('Resolved');
	await expect(page.getByText('No matching incidents', { exact: true })).toBeVisible();
	await expect(warning).toContainText('2 alerts waiting');
	await warning.getByRole('button', { name: 'Enable warning sound', exact: true }).click();
	expect(await soundCount(page)).toBe(1);
	await warning.getByRole('button', { name: 'Acknowledge warning', exact: true }).click();
	await expect(
		warning.getByRole('button', { name: 'Acknowledge warning', exact: true })
	).toBeDisabled();
	await page.clock.runFor(30000);
	expect(await soundCount(page)).toBe(1);
	const db = database();
	try {
		expect(
			db
				.prepare(
					"SELECT count(*) AS n FROM incident WHERE caller_user_id=? AND status='Not assigned'"
				)
				.get(caller.id)
		).toEqual({ n: 2 });
	} finally {
		db.close();
	}
	addIncident(caller, actor.lguId);
	await refreshWarning(page, 3);
	await expect.poll(() => soundCount(page)).toBe(2);
	await expect(
		warning.getByRole('button', { name: 'Acknowledge warning', exact: true })
	).toBeEnabled();
	await warning.getByRole('button', { name: 'View oldest alert', exact: true }).click();
	await expect(
		page.getByRole('heading', { name: 'Confirm caller identity', exact: true })
	).toBeVisible();
	await page.setViewportSize({ width: 390, height: 844 });
	for (const appearance of ['light', 'dark']) {
		await page.evaluate(
			(value) => (document.documentElement.dataset.appearance = value),
			appearance
		);
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
			true
		);
		await warning.screenshot({
			path: test.info().outputPath(`unclaimed-${appearance}.png`),
			animations: 'disabled'
		});
	}
});

test('unclaimed sounds pause on failure/hidden page, clear on access loss and clean up on navigation', async ({
	page
}) => {
	test.setTimeout(90000);
	await installSound(page);
	const actor = await isolatedStaff();
	await login(page.request, actor);
	const caller = await provision();
	const created = addIncident(caller, actor.lguId);
	await page.clock.install();
	await page.goto('/dispatch');
	const warning = page.getByRole('region', { name: 'Unclaimed SOS alerts' });
	await expect(warning).toContainText('1 alert waiting');
	await warning.getByRole('button', { name: 'Enable warning sound', exact: true }).click();
	expect(await soundCount(page)).toBe(1);
	await page.route('**/api/staff/incidents/unclaimed', (route) =>
		route.fulfill({
			status: 503,
			contentType: 'application/json',
			body: JSON.stringify({ message: 'Synthetic connection failure' })
		})
	);
	await expect
		.poll(async () => {
			await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
			return warning.textContent();
		})
		.toContain('Synthetic connection failure');
	await page.clock.runFor(30000);
	expect(await soundCount(page)).toBe(1);
	await expect(warning).toContainText('1 alert waiting');
	await page.unroute('**/api/staff/incidents/unclaimed');
	await refreshWarning(page, 1);
	await expect.poll(() => soundCount(page)).toBe(2);
	await page.evaluate(() =>
		Object.defineProperty(document, 'hidden', { configurable: true, value: true })
	);
	await page.clock.runFor(30000);
	expect(await soundCount(page)).toBe(2);
	await page.evaluate(() =>
		Object.defineProperty(document, 'hidden', { configurable: true, value: false })
	);
	await page.route('**/api/staff/incidents/unclaimed', (route) =>
		route.fulfill({
			status: 403,
			contentType: 'application/json',
			body: JSON.stringify({ message: 'Synthetic access revoked' })
		})
	);
	await expect
		.poll(async () => {
			await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
			return warning.textContent();
		})
		.toContain('Synthetic access revoked');
	await expect(warning.getByText(/Oldest:/)).toHaveCount(0);
	await expect(
		warning.getByRole('button', { name: 'Enable warning sound', exact: true })
	).toBeVisible();
	await page.unroute('**/api/staff/incidents/unclaimed');
	expect(
		(
			await page.request.post(`/api/staff/incidents/${created.id}/confirm`, {
				headers,
				data: { verballyConfirmed: true }
			})
		).status()
	).toBe(200);
	await refreshWarning(page, 0);
	await expect(warning.getByText(/Oldest:/)).toHaveCount(0);
	await expect(
		warning.getByRole('button', { name: 'Acknowledge warning', exact: true })
	).toHaveCount(0);
	await page.locator('a[href="/dispatch/reports"]').first().click();
	await expect(page.getByRole('region', { name: 'Unclaimed SOS alerts' })).toHaveCount(0);
	expect(
		await page.evaluate(
			() =>
				(globalThis as typeof globalThis & { __warningAudio: { closed: number } }).__warningAudio
					.closed
		)
	).toBe(1);
});
