import { expect, test } from '@playwright/test';
import {
	stageMunicipalIntake,
	database,
	headers,
	login,
	origin,
	provision,
	sos
} from './incident-fixture';
import { approveSharingTrust, sharingInput } from './sharing-fixture';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

test('trusted SOS exposes only beneficiary coordinates in staff views and preserves the snapshot across retries', async ({
	request,
	page,
	playwright
}) => {
	test.setTimeout(90000);
	const person = await provision();
	const caller = await provision();
	const staff = await provision('dispatcher');
	approveSharingTrust(person.profileId, caller.profileId);
	await login(request, caller);
	const owner = await playwright.request.newContext({ baseURL: origin });
	const oversight = await playwright.request.newContext({ baseURL: origin });
	try {
		await login(owner, person);
		const sharing = sharingInput(caller.id);
		sharing.point = {
			latitude: 15.25,
			longitude: 121.5,
			accuracy: 18,
			recordedAt: new Date().toISOString()
		};
		const started = await owner.post('/api/sharing', { headers, data: sharing });
		expect(started.status()).toBe(200);
		const point = (await started.json()).session.point;
		// Age the last update so the existing five-minute publishing limit permits a later update.
		const recordedAt = Date.now() - 360000;
		point.recordedAt = new Date(recordedAt).toISOString();
		const db = database();
		try {
			db.prepare('UPDATE location_session SET created_at=? WHERE id=?').run(recordedAt, sharing.id);
			db.prepare('UPDATE location_point SET recorded_at=? WHERE session_id=?').run(
				recordedAt,
				sharing.id
			);
		} finally {
			db.close();
		}
		const input = { ...sos(person.profileId), locationLabel: 'SENDER-ONLY-LOCATION-MARKER' };
		const created = await request.post('/api/incidents', { headers, data: input });
		expect(created.status()).toBe(201);
		const { id, reference } = (await created.json()).incident;
		const staffDb = database();
		try {
			staffDb
				.prepare('INSERT INTO staff_lgu (user_id,lgu_id) VALUES (?,?)')
				.run(staff.id, 'provincial-intake');
		} finally {
			staffDb.close();
		}
		await login(oversight, await provision('admin'));
		const oversightDetail = await (await oversight.get(`/api/staff/incidents/${id}`)).json();
		expect(oversightDetail.coordination).toMatchObject({
			latitude: point.latitude,
			longitude: point.longitude,
			locationLabel: '',
			personLocation: point
		});
		expect(JSON.stringify(oversightDetail)).not.toContain(input.locationLabel);
		expect(JSON.stringify(oversightDetail)).not.toContain(String(input.latitude));
		await login(page.request, staff);
		expect(
			(await (await page.request.get(`/api/staff/incidents/${id}`)).json()).personal
		).toBeNull();
		expect(
			(
				await page.request.post(`/api/staff/incidents/${id}/confirm`, {
					headers,
					data: { verballyConfirmed: true }
				})
			).status()
		).toBe(200);
		let detail = await (await page.request.get(`/api/staff/incidents/${id}`)).json();
		expect(detail.personal).toMatchObject({
			latitude: point.latitude,
			longitude: point.longitude,
			personLocation: point
		});
		expect(JSON.stringify(detail)).not.toContain(input.locationLabel);
		expect(detail.personal.locationLabel).toBe('');
		const moved = await owner.post(`/api/sharing/${sharing.id}/points`, {
			headers,
			data: { ...sharing.point, latitude: 16, recordedAt: new Date().toISOString() }
		});
		expect(moved.status()).toBe(200);
		expect(
			(await owner.post(`/api/sharing/${sharing.id}/stop`, { headers, data: {} })).status()
		).toBe(200);
		const retry = await request.post('/api/incidents', { headers, data: input });
		expect(retry.status()).toBe(200);
		expect((await retry.json()).incident.id).toBe(id);
		detail = await (await page.request.get(`/api/staff/incidents/${id}`)).json();
		expect(detail.personal.personLocation).toEqual(point);
		expect(
			(await (await page.request.get(`/api/staff/reports/${id}`)).json()).personLocation
		).toEqual(point);
		await page.goto('/dispatch');
		const providerRequests: string[] = [];
		await page.route('https://www.openstreetmap.org/**', (route) => {
			providerRequests.push(route.request().url());
			return route.fulfill({
				contentType: 'text/html',
				body: '<html><body>Test incident map</body></html>'
			});
		});
		const location = page.getByRole('region', { name: 'Incident location', exact: true });
		await expect(location).toContainText('15.25, 121.5');
		await expect(location).toContainText('Approximately 18 metres');
		await expect(location).not.toContainText('Reporter’s device location');
		await expect(location).not.toContainText(`${input.latitude}, ${input.longitude}`);
		await expect(location.locator('iframe')).toHaveCount(0);
		expect(providerRequests).toEqual([]);
		await location.getByRole('button', { name: 'Load map', exact: true }).click();
		await expect(location.getByTitle('Map of incident location')).toHaveAttribute(
			'src',
			/marker=15.25%2C121.5/
		);
		await expect.poll(() => providerRequests.length).toBe(1);
		expect(providerRequests[0]).not.toContain(String(input.latitude));
		await page.setViewportSize({ width: 390, height: 844 });
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
			true
		);
		await location.screenshot({
			path: test.info().outputPath('dispatch-incident-map.png'),
			animations: 'disabled'
		});
		await page.goto('/dispatch/reports');
		await page.getByRole('button').filter({ hasText: reference }).click();
		await expect(location).toContainText('15.25, 121.5');
		await expect(location).toContainText('This is not live tracking.');
		await expect(location).not.toContainText(`${input.latitude}, ${input.longitude}`);
		await location.getByRole('button', { name: 'Load map', exact: true }).click();
		await expect(location.getByTitle('Map of incident location')).toHaveAttribute(
			'src',
			/marker=15.25%2C121.5/
		);
		const report = await (await page.request.get(`/api/staff/reports/${id}`)).json();
		expect(report).toMatchObject({
			latitude: point.latitude,
			longitude: point.longitude,
			locationLabel: ''
		});
		const pdf = await page.request.get(`/api/staff/reports/export?search=${reference}&status=All`);
		expect(pdf.status()).toBe(200);
		const task = getDocument({ data: new Uint8Array(await pdf.body()), useSystemFonts: true });
		const document = await task.promise;
		let contents = '';
		for (let number = 1; number <= document.numPages; number++) {
			const content = await (await document.getPage(number)).getTextContent();
			contents += content.items.map((item) => ('str' in item ? item.str : '')).join(' ');
		}
		await task.destroy();
		expect(contents).toContain('15.25, 121.5');
		expect(contents).not.toContain(input.locationLabel);
		expect(contents).not.toContain(String(input.latitude));
	} finally {
		await owner.dispose();
		await oversight.dispose();
	}
});

for (const unavailable of [
	'not selected',
	'recipient revoked',
	'expired',
	'cancelled',
	'no point',
	'no session'
]) {
	test(`trusted SOS does not expose location when sharing is ${unavailable}`, async ({
		request,
		page
	}) => {
		const person = await provision();
		const caller = await provision();
		approveSharingTrust(person.profileId, caller.profileId);
		const sessionId = crypto.randomUUID();
		const db = database();
		try {
			const now = Date.now();
			if (unavailable !== 'no session') {
				db.prepare(
					'INSERT INTO location_session (id,owner_profile_id,created_at,expires_at,cancelled_at) VALUES (?,?,?,?,?)'
				).run(
					sessionId,
					person.profileId,
					now - 120000,
					unavailable === 'expired' ? now - 1000 : now + 600000,
					unavailable === 'cancelled' ? now : null
				);
				if (unavailable !== 'not selected')
					db.prepare(
						'INSERT INTO location_recipient (id,session_id,user_id,revoked_at) VALUES (?,?,?,?)'
					).run(
						crypto.randomUUID(),
						sessionId,
						caller.id,
						unavailable === 'recipient revoked' ? now : null
					);
				if (unavailable !== 'no point')
					db.prepare(
						'INSERT INTO location_point (id,session_id,latitude,longitude,accuracy,recorded_at) VALUES (?,?,?,?,?,?)'
					).run(crypto.randomUUID(), sessionId, 15.25, 121.5, 18, now - 60000);
			}
		} finally {
			db.close();
		}
		await login(request, caller);
		const created = await request.post('/api/incidents', { headers, data: sos(person.profileId) });
		expect(created.status()).toBe(201);
		const { id } = (await created.json()).incident;
		stageMunicipalIntake(id);
		await login(page.request, await provision('dispatcher'));
		expect(
			(
				await page.request.post(`/api/staff/incidents/${id}/confirm`, {
					headers,
					data: { verballyConfirmed: true }
				})
			).status()
		).toBe(200);
		const report = await (await page.request.get(`/api/staff/reports/${id}`)).json();
		expect(report.personLocation).toBeNull();
		expect(report).toMatchObject({ latitude: null, longitude: null, locationLabel: '' });
		if (unavailable === 'no session') {
			await page.goto('/dispatch');
			await expect(page.getByRole('region', { name: 'Incident location' })).toContainText(
				'No shared location was available when SOS was sent.'
			);
			await expect(page.getByRole('region', { name: 'Incident location' })).toContainText(
				'Map unavailable: no saved GPS location.'
			);
			await expect(page.getByRole('button', { name: 'Load map', exact: true })).toHaveCount(0);
			await expect(page.locator('iframe')).toHaveCount(0);
		}
	});
}

test('clients cannot supply a beneficiary location snapshot and self SOS keeps its reported coordinates', async ({
	request,
	page
}) => {
	const caller = await provision();
	await login(request, caller);
	const input = sos(caller.profileId);
	expect(
		(
			await request.post('/api/incidents', {
				headers,
				data: { ...input, personLocation: { latitude: 1, longitude: 2 } }
			})
		).status()
	).toBe(422);
	const created = await request.post('/api/incidents', { headers, data: input });
	expect(created.status()).toBe(201);
	const { id } = (await created.json()).incident;
	stageMunicipalIntake(id);
	await login(page.request, await provision('dispatcher'));
	expect(
		(
			await page.request.post(`/api/staff/incidents/${id}/confirm`, {
				headers,
				data: { verballyConfirmed: true }
			})
		).status()
	).toBe(200);
	expect(await (await page.request.get(`/api/staff/reports/${id}`)).json()).toMatchObject({
		personLocation: null,
		latitude: input.latitude,
		longitude: input.longitude
	});
	await page.route('https://www.openstreetmap.org/**', (route) =>
		route.fulfill({ contentType: 'text/html', body: '<html><body>Test self map</body></html>' })
	);
	await page.goto('/dispatch');
	await page.getByRole('button', { name: 'Load map', exact: true }).click();
	await expect(page.getByTitle('Map of incident location')).toHaveAttribute(
		'src',
		/marker=14.5995%2C120.9842/
	);
});
