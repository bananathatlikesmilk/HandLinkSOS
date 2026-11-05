import { expect, test } from '@playwright/test';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import {
	database,
	headers,
	login,
	origin,
	privateMedical,
	provision,
	sos
} from './incident-fixture';
import { installNativeBridge, type NativeTestState } from './native-fixture';

function stranger() {
	return {
		personProfileId: null,
		strangerName: '',
		emergencyDescription: 'Person fell near the market. Awake and asking for help.',
		locationSource: 'reported',
		latitude: null,
		longitude: null,
		locationLabel: 'Example market, Example barangay, Example municipality',
		idempotencyKey: crypto.randomUUID()
	};
}

test('stranger SOS validates identity and location, isolates medical details, and reaches reports and PDF', async ({
	request,
	page,
	playwright
}) => {
	test.setTimeout(180000);
	expect((await request.post('/api/incidents', { headers, data: stranger() })).status()).toBe(401);
	const caller = await provision(),
		staff = await provision('dispatcher'),
		other = await provision('dispatcher'),
		municipal = await provision('dispatcher');
	const db = database();
	try {
		for (const actor of [staff, other])
			db.prepare('INSERT INTO staff_lgu (user_id,lgu_id) VALUES (?,?)').run(
				actor.id,
				'provincial-intake'
			);
	} finally {
		db.close();
	}
	await login(request, caller);
	const input = stranger();
	for (const invalid of [
		{ ...input, emergencyDescription: ' ' },
		{ ...input, emergencyDescription: 'x'.repeat(1001) },
		{ ...input, locationLabel: ' ' },
		{ ...input, locationSource: 'device' },
		{ ...input, latitude: 14 },
		{ ...input, latitude: 91, longitude: 121 },
		{ ...input, callerUserId: other.id },
		{ ...input, personProfileId: caller.profileId }
	])
		expect((await request.post('/api/incidents', { headers, data: invalid })).status()).toBe(422);
	const created = await request.post('/api/incidents', { headers, data: input });
	expect(created.status(), await created.text()).toBe(201);
	const row = (await created.json()).incident;
	expect(row).toMatchObject({
		personName: 'Unknown person',
		isStranger: true,
		isForSomeoneElse: true,
		callerRelationship: 'Bystander',
		lguId: 'provincial-intake',
		suggestedLguId: null,
		emergencyDescription: input.emergencyDescription
	});
	const retry = await request.post('/api/incidents', { headers, data: input });
	expect(retry.status()).toBe(200);
	expect((await retry.json()).incident.id).toBe(row.id);
	expect(
		(
			await request.post('/api/incidents', {
				headers,
				data: { ...input, emergencyDescription: 'Different emergency' }
			})
		).status()
	).toBe(409);
	// Separate reports may describe separate strangers. Do not collapse all unknown people into one person.
	const deviceSos = await request.post('/api/incidents', {
		headers,
		data: {
			...input,
			idempotencyKey: crypto.randomUUID(),
			strangerName: 'Example Person',
			latitude: 14.5,
			longitude: 121.5,
			locationSource: 'device',
			locationLabel: ''
		}
	});
	expect(deviceSos.status()).toBe(201);
	const deviceIncident = (await deviceSos.json()).incident;
	expect(
		(await request.post('/api/incidents', { headers, data: sos(caller.profileId) })).status()
	).toBe(201);
	const check = database();
	try {
		expect(
			check
				.prepare('SELECT person_profile_id,latitude,longitude FROM incident WHERE id=?')
				.get(row.id)
		).toEqual({ person_profile_id: null, latitude: null, longitude: null });
		expect(
			check.prepare('SELECT count(*) AS n FROM notification WHERE incident_id=?').get(row.id)
		).toEqual({ n: 0 });
	} finally {
		check.close();
	}
	const outsider = await playwright.request.newContext({ baseURL: origin });
	try {
		await login(outsider, municipal);
		expect((await outsider.get(`/api/staff/incidents/${row.id}`)).status()).toBe(404);
		await login(page.request, staff);
		const endpoint = `/api/staff/incidents/${row.id}`;
		const detail = await (await page.request.get(endpoint)).json();
		expect(detail.personal).toBeNull();
		expect(detail.medical).toBeNull();
		expect(detail.emergencyContacts).toEqual([]);
		expect(detail.coordination).toMatchObject({
			latitude: null,
			longitude: null,
			locationLabel: input.locationLabel
		});
		await page.goto('/dispatch');
		await page.getByRole('button', { name: new RegExp(row.reference) }).click();
		await expect(page.getByLabel('Caller-reported emergency', { exact: true })).toContainText(
			input.emergencyDescription
		);
		await expect(page.getByLabel('Incident location', { exact: true })).toContainText(
			input.locationLabel
		);
		await expect(page.getByLabel('Incident location', { exact: true })).toContainText(
			'Map unavailable: no saved GPS location.'
		);
		await expect(page.getByRole('button', { name: 'Load map', exact: true })).toHaveCount(0);
		await page.getByRole('checkbox', { name: /I verbally confirmed/ }).check();
		await page.getByRole('button', { name: 'Confirm caller and handle case', exact: true }).click();
		const notes = page.getByRole('textbox', { name: 'Additional information', exact: true });
		await expect(notes).toBeVisible();
		await expect(
			page.getByText(
				'Caller confirmed. You are handling this case. No registered profile is linked.',
				{ exact: true }
			)
		).toBeVisible();
		await page.setViewportSize({ width: 390, height: 844 });
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
			true
		);
		await page.screenshot({
			path: test.info().outputPath('stranger-dispatch-mobile.png'),
			fullPage: true,
			animations: 'disabled'
		});
		await expect(
			page.getByRole('button', { name: 'Medical information', exact: true })
		).toHaveCount(0);
		await expect(page.getByText(privateMedical, { exact: true })).toHaveCount(0);
		await notes.fill(
			'Caller confirms the person is awake. Municipal duty officer contacted through official hotline.'
		);
		await expect(page.getByText('Notes saved', { exact: true })).toBeVisible();
		const saved = await (await page.request.get(endpoint)).json();
		expect(saved.medical).toBeNull();
		expect(saved.personal).toBeNull();
		expect(saved.noteId).toBeTruthy();
		await login(outsider, other);
		expect(
			(
				await outsider.post(`${endpoint}/notes`, { headers, data: { notes: 'Not my case.' } })
			).status()
		).toBe(403);
		const preview = await page.request.get(`/api/staff/reports/${row.id}/summary/preview`);
		// Preview must handle an absent registered beneficiary without dereferencing their profile.
		expect(preview.status(), await preview.text()).toBe(200);
		const filtered = await (
			await page.request.get(
				`/api/staff/incidents?view=reports&status=All&sosType=stranger&search=${row.reference}`
			)
		).json();
		expect(filtered.total).toBe(1);
		expect(filtered.incidents[0].isStranger).toBe(true);
		expect(
			(
				await (
					await page.request.get(
						`/api/staff/incidents?view=reports&status=All&sosType=trusted&search=${row.reference}`
					)
				).json()
			).total
		).toBe(0);
		const pdf = await page.request.get(
			`/api/staff/reports/export?status=All&sosType=stranger&search=${row.reference}`
		);
		expect(pdf.status(), await pdf.text()).toBe(200);
		const task = getDocument({ data: new Uint8Array(await pdf.body()), useSystemFonts: true });
		try {
			const doc = await task.promise;
			let text = '';
			for (let i = 1; i <= doc.numPages; i++) {
				const content = await (await doc.getPage(i)).getTextContent();
				text += content.items.map((item) => ('str' in item ? item.str : '')).join(' ');
			}
			expect(text).toContain('For an unregistered person');
			expect(text).toContain(input.locationLabel);
			expect(text).toContain('Person fell near the market');
			expect(text).not.toContain(privateMedical);
			expect(text).not.toContain('Beneficiary shared location: unavailable');
		} finally {
			await task.destroy();
		}
		await page.route('https://www.openstreetmap.org/**', (route) =>
			route.fulfill({
				contentType: 'text/html',
				body: '<html><body>Test stranger map</body></html>'
			})
		);
		await page.goto('/dispatch');
		await page.getByRole('button', { name: new RegExp(deviceIncident.reference) }).click();
		await page.getByRole('button', { name: 'Load map', exact: true }).click();
		await expect(page.getByTitle('Map of incident location')).toHaveAttribute(
			'src',
			/marker=14.5%2C121.5/
		);
		// An address-only case must never retain another incident's map.
		await page.getByRole('button', { name: new RegExp(row.reference) }).click();
		await expect(page.getByTitle('Map of incident location')).toHaveCount(0);
	} finally {
		await outsider.dispose();
	}
});

test('stranger SOS form supports address without GPS, cancellation, and saved-request recovery', async ({
	page
}) => {
	test.setTimeout(90000);
	await login(page.request, await provision());
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/user/dashboard');
	await page.getByRole('link', { name: "SOS for someone I don't know", exact: true }).click();
	const next = page.getByRole('button', { name: 'Continue to SOS countdown' });
	await expect(next).toBeDisabled();
	await page
		.getByRole('textbox', { name: 'What happened? *', exact: true })
		.fill('Someone needs help near the market.');
	await page.getByRole('radio', { name: "I'm elsewhere. Enter their address." }).check();
	await expect(next).toBeDisabled();
	await page
		.getByRole('textbox', { name: 'Emergency address / landmark *', exact: true })
		.fill('Example market, Example municipality');
	for (const appearance of ['light', 'dark']) {
		await page.evaluate(
			(value) => document.documentElement.setAttribute('data-appearance', value),
			appearance
		);
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
			true
		);
		await expect(next).toHaveCSS('color', 'rgb(255, 255, 255)');
		await page.screenshot({
			path: test.info().outputPath(`stranger-form-${appearance}.png`),
			fullPage: true,
			animations: 'disabled'
		});
	}
	let sent = 0;
	page.on('request', (r) => {
		if (r.method() === 'POST' && r.url().endsWith('/api/incidents')) sent++;
	});
	await next.click();
	await page.getByRole('button', { name: 'Cancel SOS', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'SOS cancelled', exact: true })).toBeVisible();
	expect(sent).toBe(0);
	await page.goto('/user/sos?stranger=1');
	await page
		.getByRole('textbox', { name: 'What happened? *', exact: true })
		.fill('Someone needs help near the market.');
	await page.getByRole('radio', { name: "I'm elsewhere. Enter their address." }).check();
	await page
		.getByRole('textbox', { name: 'Emergency address / landmark *', exact: true })
		.fill('Example market, Example municipality');
	await next.click();
	// Lose the first response after the server saves the alert. Reload must retry the original key.
	await page.route('**/api/incidents', async (route) => {
		if (route.request().method() !== 'POST') return route.continue();
		await route.fetch();
		await route.abort('failed');
	});
	await page.getByRole('button', { name: 'Send SOS now', exact: true }).click();
	await expect(
		page.getByRole('button', { name: 'Retry saved SOS request', exact: true })
	).toBeVisible();
	await page.unroute('**/api/incidents');
	await page.reload();
	await page.getByRole('button', { name: 'Retry saved SOS request', exact: true }).click();
	await expect(page).toHaveURL(/\/user\/call\?incident=/);
	const own = await (await page.request.get('/api/incidents')).json();
	expect(own.incidents).toHaveLength(1);
	expect(own.incidents[0]).toMatchObject({ isStranger: true, personName: 'Unknown person' });
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('stranger SOS uses reporter GPS only after choosing to be with the person and opens dialer once', async ({
	page
}) => {
	await installNativeBridge(page);
	await login(page.request, await provision());
	await page.goto('/user/sos?stranger=1');
	await page
		.getByRole('textbox', { name: 'What happened? *', exact: true })
		.fill('A person fell. I am beside them.');
	await page.getByRole('button', { name: 'Continue to SOS countdown' }).click();
	await page.getByRole('button', { name: 'Send SOS now', exact: true }).click();
	await expect(page).toHaveURL(/\/user\/call\?incident=/);
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					(globalThis as typeof globalThis & NativeTestState).__handlinkNativeTest.dialerAttempts
			)
		)
		.toBe(1);
	const own = await (await page.request.get('/api/incidents')).json();
	const db = database();
	try {
		const row = db
			.prepare(
				'SELECT person_profile_id,latitude,longitude,location_source FROM incident WHERE id=?'
			)
			.get(own.incidents[0].id) as {
			person_profile_id: null;
			latitude: number;
			longitude: number;
			location_source: string;
		};
		expect(row.person_profile_id).toBeNull();
		expect(row.location_source).toBe('device');
		expect(row.latitude).not.toBeNull();
		expect(row.longitude).not.toBeNull();
	} finally {
		db.close();
	}
	await page.reload();
	expect(
		await page.evaluate(
			() => (globalThis as typeof globalThis & NativeTestState).__handlinkNativeTest.dialerAttempts
		)
	).toBe(0);
});
