import { expect, test } from '@playwright/test';
import { database, headers, login, origin, provision, sos } from './incident-fixture';
import { approveSharingTrust, sharingInput } from './sharing-fixture';

test('trusted SOS snapshots the beneficiary shared location, preserves retries and labels both locations in staff views', async ({
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
		const input = sos(person.profileId);
		const created = await request.post('/api/incidents', { headers, data: input });
		expect(created.status()).toBe(201);
		const { id, reference } = (await created.json()).incident;
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
			latitude: input.latitude,
			longitude: input.longitude,
			personLocation: point
		});
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
		const location = page.getByRole('region', { name: 'Incident location', exact: true });
		await expect(location).toContainText('15.25, 121.5');
		await expect(location).toContainText('Approximately 18 metres');
		await expect(location).toContainText('Reporter’s device location');
		await expect(location).toContainText(`${input.latitude}, ${input.longitude}`);
		await page.goto('/dispatch/reports');
		await page.getByRole('button').filter({ hasText: reference }).click();
		await expect(location).toContainText('15.25, 121.5');
		await expect(location).toContainText('This is not live tracking.');
	} finally {
		await owner.dispose();
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
		if (unavailable === 'no session') {
			await page.goto('/dispatch');
			await expect(page.getByRole('region', { name: 'Incident location' })).toContainText(
				'No shared location was available when SOS was sent.'
			);
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
});
