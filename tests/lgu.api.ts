import { expect, test, type APIRequestContext } from '@playwright/test';
import { database, headers, login, origin, password, provision, sos } from './incident-fixture';
import { approveSharingTrust, sharingInput } from './sharing-fixture';

function polygon(west: number) {
	return {
		type: 'Polygon',
		coordinates: [
			[
				[west, 14],
				[west + 1, 14],
				[west + 1, 15],
				[west, 15],
				[west, 14]
			]
		]
	};
}
async function addLgu(api: APIRequestContext, west: number) {
	const body = { name: `Test LGU ${crypto.randomUUID()}`, active: true, boundary: polygon(west) };
	const response = await api.post('/api/admin/lgus', { headers, data: body });
	expect(response.status(), await response.text()).toBe(201);
	return { ...(await response.json()).lgu, input: body };
}
async function cleanLgus(api: APIRequestContext, rows: { id: string; name: string }[]) {
	void api;
	// Reset only isolated test fixtures so other test files keep their initial legacy routing mode.
	const db = database();
	try {
		for (const row of rows)
			db.prepare('UPDATE lgu SET activated_at=NULL,active=0,boundary=NULL WHERE id=?').run(row.id);
	} finally {
		db.close();
	}
}

test('draft boundaries keep legacy routing; deactivating an activated boundary never silently restores it', async ({
	page,
	playwright
}) => {
	test.setTimeout(120000);
	await login(page.request, await provision('admin'));
	const input = { name: `Draft LGU ${crypto.randomUUID()}`, boundary: polygon(120), active: false };
	const created = await page.request.post('/api/admin/lgus', { headers, data: input });
	expect(created.status()).toBe(201);
	const row = (await created.json()).lgu;
	const staged = await page.request.post('/api/admin/accounts', {
		headers,
		data: {
			name: 'Staged staff',
			email: `${crypto.randomUUID()}@example.com`,
			password,
			role: 'dispatcher',
			lguId: row.id
		}
	});
	expect(staged.status()).toBe(201);
	expect((await staged.json()).account).toMatchObject({ lguId: row.id, centralAdmin: false });
	const caller = await playwright.request.newContext({ baseURL: origin });
	try {
		const first = await provision();
		await login(caller, first);
		const before = await caller.post('/api/incidents', {
			headers,
			data: { ...sos(first.profileId), latitude: 14.5, longitude: 120.5 }
		});
		expect(before.status()).toBe(201);
		const legacy = (await before.json()).incident;
		expect(legacy).toMatchObject({ lguId: 'legacy', routingReason: 'unconfigured' });
		expect(
			(
				await page.request.put(`/api/admin/lgus/${row.id}`, {
					headers,
					data: { ...input, active: true }
				})
			).status()
		).toBe(200);
		expect(
			(await page.request.put(`/api/admin/lgus/${row.id}`, { headers, data: input })).status()
		).toBe(200);
		const second = await provision();
		await login(caller, second);
		const after = await caller.post('/api/incidents', {
			headers,
			data: { ...sos(second.profileId), latitude: 14.5, longitude: 120.5 }
		});
		expect((await after.json()).incident).toMatchObject({
			lguId: null,
			routingReason: 'outside_boundaries'
		});
		expect(
			(await (await page.request.get(`/api/staff/incidents/${legacy.id}`)).json()).incident.lguId
		).toBe('legacy');
	} finally {
		await cleanLgus(page.request, [row]);
		await caller.dispose();
	}
});

test('GPS LGUs isolate queues, direct-ID operations, local administration and dashboards', async ({
	page,
	playwright
}) => {
	test.setTimeout(240000);
	const central = await provision('admin');
	await login(page.request, central);
	const a = await addLgu(page.request, 120),
		b = await addLgu(page.request, 122);
	const staffA = await provision('dispatcher'),
		staffB = await provision('dispatcher'),
		manager = await provision('admin'),
		caller = await provision();
	const contexts = await Promise.all(
		Array.from({ length: 4 }, () => playwright.request.newContext({ baseURL: origin }))
	);
	const [alpha, bravo, admin, user] = contexts;
	try {
		for (const [actor, jurisdiction] of [
			[staffA, a],
			[staffB, b],
			[manager, a]
		] as const)
			expect(
				(
					await page.request.put(`/api/admin/accounts/${actor.id}/lgu`, {
						headers,
						data: { lguId: jurisdiction.id }
					})
				).status()
			).toBe(200);
		await login(alpha, staffA);
		await login(bravo, staffB);
		await login(admin, manager);
		await login(user, caller);
		const payload = { ...sos(caller.profileId), latitude: 14.5, longitude: 122.5 };
		expect(
			(await user.post('/api/incidents', { headers, data: { ...payload, lguId: a.id } })).status()
		).toBe(422);
		const response = await user.post('/api/incidents', { headers, data: payload });
		expect(response.status()).toBe(201);
		const incident = (await response.json()).incident;
		expect(incident).toMatchObject({ lguId: b.id, routingReason: 'gps' });
		expect(
			(await (await alpha.get('/api/staff/incidents')).json()).incidents.some(
				(row: { id: string }) => row.id === incident.id
			)
		).toBe(false);
		expect((await alpha.get(`/api/staff/incidents/${incident.id}`)).status()).toBe(404);
		expect(
			(
				await alpha.post(`/api/staff/incidents/${incident.id}/confirm`, {
					headers,
					data: { verballyConfirmed: true }
				})
			).status()
		).toBe(404);
		expect(
			(
				await bravo.post(`/api/staff/incidents/${incident.id}/confirm`, {
					headers,
					data: { verballyConfirmed: true }
				})
			).status()
		).toBe(200);
		for (const path of [
			`/api/staff/incidents/${incident.id}`,
			`/api/staff/reports/${incident.id}`,
			`/api/staff/reports/${incident.id}/summary/preview`
		])
			expect((await alpha.get(path)).status()).toBe(404);
		expect(
			(
				await alpha.patch(`/api/staff/incidents/${incident.id}`, {
					headers,
					data: { status: 'On route' }
				})
			).status()
		).toBe(404);
		expect(
			(
				await alpha.post(`/api/staff/incidents/${incident.id}/notes`, {
					headers,
					data: { notes: 'wrong LGU' }
				})
			).status()
		).toBe(404);
		expect(
			(
				await alpha.post(`/api/staff/incidents/${incident.id}/cancellation`, {
					headers,
					data: { decision: 'approve' }
				})
			).status()
		).toBe(404);
		expect(
			(
				await alpha.post(`/api/staff/reports/${incident.id}/addenda`, {
					headers,
					data: { id: crypto.randomUUID(), notes: 'wrong LGU' }
				})
			).status()
		).toBe(404);
		expect((await admin.get(`/api/staff/reports/${incident.id}`)).status()).toBe(404);
		expect((await page.request.get(`/api/staff/reports/${incident.id}`)).status()).toBe(200);
		const listed = (await (await admin.get('/api/admin/accounts')).json()).accounts;
		expect(listed.some((row: { id: string }) => row.id === staffA.id)).toBe(true);
		expect(
			listed.some((row: { id: string }) => [central.id, staffB.id, caller.id].includes(row.id))
		).toBe(false);
		for (const path of ['/api/admin/lgus', '/api/admin/ai-settings'])
			expect((await admin.get(path)).status()).toBe(403);
		expect(
			(
				await admin.patch(`/api/admin/accounts/${staffB.id}`, { headers, data: { active: false } })
			).status()
		).toBe(404);
		expect(
			(
				await admin.post(`/api/admin/accounts/${staffB.id}/verification`, { headers, data: {} })
			).status()
		).toBe(404);
		expect(
			(
				await admin.put(`/api/admin/accounts/${staffA.id}/lgu`, { headers, data: { lguId: b.id } })
			).status()
		).toBe(403);
		const newStaff = {
			name: 'Scoped Admin',
			email: `${crypto.randomUUID()}@example.com`,
			password,
			role: 'admin'
		};
		expect(
			(
				await admin.post('/api/admin/accounts', { headers, data: { ...newStaff, lguId: b.id } })
			).status()
		).toBe(403);
		const created = await admin.post('/api/admin/accounts', { headers, data: newStaff });
		expect(created.status()).toBe(201);
		expect((await created.json()).account).toMatchObject({ lguId: a.id, centralAdmin: false });
		expect((await (await admin.get('/api/admin/dashboard')).json()).inProgress).toBe(0);
		expect(
			(
				await page.request.put(`/api/admin/accounts/${staffB.id}/lgu`, {
					headers,
					data: { lguId: a.id }
				})
			).status()
		).toBe(409);
		expect(
			(
				await page.request.put(`/api/admin/lgus/${b.id}`, {
					headers,
					data: { ...b.input, active: false }
				})
			).status()
		).toBe(409);
		expect(
			(
				await page.request.put(`/api/admin/lgus/${a.id}`, {
					headers,
					data: { ...a.input, active: false }
				})
			).status()
		).toBe(200);
		expect((await alpha.get('/api/staff/incidents')).status()).toBe(403);
		expect(
			(await page.request.put(`/api/admin/lgus/${a.id}`, { headers, data: a.input })).status()
		).toBe(200);
		await page.goto('/admin/lgus');
		await expect(
			page.getByRole('heading', { name: 'LGUs and GPS routing', exact: true })
		).toBeVisible();
		await page.getByRole('button', { name: `Edit ${a.name}`, exact: true }).click();
		await expect(page.getByLabel('LGU name', { exact: false })).toHaveValue(a.name);
	} finally {
		await cleanLgus(page.request, [a, b]);
		for (const ctx of contexts) await ctx.dispose();
	}
});

test('GPS overlaps, outside locations and missing beneficiary GPS need central review; manual routing is audited', async ({
	page,
	playwright
}) => {
	test.setTimeout(180000);
	await login(page.request, await provision('admin'));
	const a = await addLgu(page.request, 120),
		b = await addLgu(page.request, 122);
	const person = await provision(),
		caller = await provision(),
		unlocated = await provision(),
		staff = await provision('dispatcher');
	approveSharingTrust(person.profileId, caller.profileId);
	approveSharingTrust(unlocated.profileId, caller.profileId);
	const owner = await playwright.request.newContext({ baseURL: origin }),
		sender = await playwright.request.newContext({ baseURL: origin }),
		dispatcher = await playwright.request.newContext({ baseURL: origin });
	let overlap: Awaited<ReturnType<typeof addLgu>> | undefined;
	try {
		await login(owner, person);
		await login(sender, caller);
		const sharing = sharingInput(caller.id);
		sharing.point.latitude = 14.5;
		sharing.point.longitude = 122.5;
		expect((await owner.post('/api/sharing', { headers, data: sharing })).status()).toBe(200);
		const trusted = await sender.post('/api/incidents', {
			headers,
			data: { ...sos(person.profileId), latitude: 14.5, longitude: 120.5 }
		});
		expect(trusted.status()).toBe(201);
		expect((await trusted.json()).incident.lguId).toBe(b.id);
		const unknown = await sender.post('/api/incidents', {
			headers,
			data: { ...sos(unlocated.profileId), latitude: 14.5, longitude: 120.5 }
		});
		expect(unknown.status()).toBe(201);
		const unrouted = (await unknown.json()).incident;
		expect(unrouted).toMatchObject({
			lguId: null,
			routingReason: 'beneficiary_location_unavailable'
		});
		const stalePerson = await provision();
		approveSharingTrust(stalePerson.profileId, caller.profileId);
		await login(owner, stalePerson);
		const staleSharing = sharingInput(caller.id);
		staleSharing.point.latitude = 14.5;
		staleSharing.point.longitude = 122.5;
		expect((await owner.post('/api/sharing', { headers, data: staleSharing })).status()).toBe(200);
		const staleDb = database();
		try {
			staleDb
				.prepare('UPDATE location_point SET recorded_at=? WHERE session_id=?')
				.run(Date.now() - 360000, staleSharing.id);
		} finally {
			staleDb.close();
		}
		const stale = await sender.post('/api/incidents', {
			headers,
			data: { ...sos(stalePerson.profileId), latitude: 14.5, longitude: 120.5 }
		});
		expect((await stale.json()).incident).toMatchObject({
			lguId: null,
			routingReason: 'beneficiary_location_unavailable'
		});
		expect(
			(
				await sender.put(`/api/admin/incidents/${unrouted.id}/lgu`, {
					headers,
					data: { lguId: a.id }
				})
			).status()
		).toBe(403);
		const pending = (await (await page.request.get('/api/staff/incidents?lguId=unrouted')).json())
			.incidents;
		expect(pending.some((row: { id: string }) => row.id === unrouted.id)).toBe(true);
		expect(
			(
				await page.request.put(`/api/admin/incidents/${unrouted.id}/lgu`, {
					headers,
					data: { lguId: a.id }
				})
			).status()
		).toBe(200);
		const db = database();
		try {
			expect(
				db.prepare('SELECT to_lgu_id FROM lgu_routing_audit WHERE incident_id=?').all(unrouted.id)
			).toEqual([{ to_lgu_id: a.id }]);
		} finally {
			db.close();
		}
		expect(
			(
				await page.request.put(`/api/admin/accounts/${staff.id}/lgu`, {
					headers,
					data: { lguId: a.id }
				})
			).status()
		).toBe(200);
		await login(dispatcher, staff);
		expect(
			(
				await dispatcher.post(`/api/staff/incidents/${unrouted.id}/confirm`, {
					headers,
					data: { verballyConfirmed: true }
				})
			).status()
		).toBe(200);
		expect(
			(
				await page.request.put(`/api/admin/incidents/${unrouted.id}/lgu`, {
					headers,
					data: { lguId: b.id }
				})
			).status()
		).toBe(409);
		const outsidePerson = await provision();
		await login(owner, outsidePerson);
		const outside = await owner.post('/api/incidents', {
			headers,
			data: { ...sos(outsidePerson.profileId), latitude: 20, longitude: 125 }
		});
		expect((await outside.json()).incident).toMatchObject({
			lguId: null,
			routingReason: 'outside_boundaries'
		});
		overlap = await addLgu(page.request, 120);
		const third = await provision();
		await login(sender, third);
		const ambiguous = await sender.post('/api/incidents', {
			headers,
			data: { ...sos(third.profileId), latitude: 14.5, longitude: 120.5 }
		});
		expect((await ambiguous.json()).incident).toMatchObject({
			lguId: null,
			routingReason: 'ambiguous'
		});
		await page.goto('/admin/lgus');
		await expect(page.getByRole('region', { name: 'Central routing review' })).toContainText(
			'Outside configured boundaries'
		);
	} finally {
		await cleanLgus(page.request, overlap ? [a, b, overlap] : [a, b]);
		await owner.dispose();
		await sender.dispose();
		await dispatcher.dispose();
	}
});

test('central Admin can add an LGU and upload its boundary through the management page', async ({
	page
}) => {
	test.setTimeout(90000);
	await login(page.request, await provision('admin'));
	const name = 'UI LGU ' + crypto.randomUUID();
	let id = '';
	try {
		await page.goto('/admin/lgus');
		await page.getByRole('button', { name: 'Add LGU', exact: true }).click();
		await page.getByLabel('LGU name', { exact: false }).fill(name);
		await page.getByLabel('Import GeoJSON boundary', { exact: true }).setInputFiles({
			name: 'test-boundary.geojson',
			mimeType: 'application/geo+json',
			buffer: Buffer.from(JSON.stringify(polygon(124)))
		});
		await expect(page.getByLabel('Boundary GeoJSON', { exact: true })).toHaveValue(
			JSON.stringify(polygon(124))
		);
		await page.getByRole('checkbox', { name: 'Activate this LGU', exact: true }).check();
		await page.getByRole('button', { name: 'Save LGU', exact: true }).click();
		await expect(page.getByRole('status')).toContainText('LGU saved.');
		const saved = (await (await page.request.get('/api/admin/lgus')).json()).lgus.find(
			(row: { name: string }) => row.name === name
		);
		expect(saved.active).toBe(true);
		id = saved.id;
		await expect(page.getByRole('region', { name: 'Configured LGUs', exact: true })).toContainText(
			name
		);
		await page.setViewportSize({ width: 390, height: 844 });
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
			true
		);
		await page.screenshot({
			path: test.info().outputPath('lgu-management-mobile.png'),
			fullPage: true,
			animations: 'disabled'
		});
	} finally {
		if (id) await cleanLgus(page.request, [{ id, name }]);
	}
});
