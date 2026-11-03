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
import { approveSharingTrust } from './sharing-fixture';

const province = 'provincial-intake';

test('provincial handler keeps caller information, notes and confirmed external response through resolution', async ({
	page,
	playwright
}, testInfo) => {
	test.setTimeout(240000);
	const admin = await playwright.request.newContext({ baseURL: origin });
	const sender = await playwright.request.newContext({ baseURL: origin });
	const other = await playwright.request.newContext({ baseURL: origin });
	const municipal = await playwright.request.newContext({ baseURL: origin });
	const staff = await provision('dispatcher'),
		second = await provision('dispatcher'),
		local = await provision('dispatcher'),
		caller = await provision();
	await login(admin, await provision('admin'));
	const added = await admin.post('/api/admin/lgus', {
		headers,
		data: {
			name: `Municipality test ${crypto.randomUUID()}`,
			active: true,
			boundary: {
				type: 'Polygon',
				coordinates: [
					[
						[120, 14],
						[121, 14],
						[121, 15],
						[120, 15],
						[120, 14]
					]
				]
			}
		}
	});
	expect(added.status()).toBe(201);
	const municipality = (await added.json()).lgu;
	try {
		for (const [actor, lguId] of [
			[staff, province],
			[second, province],
			[local, municipality.id]
		] as const)
			expect(
				(
					await admin.put(`/api/admin/accounts/${actor.id}/lgu`, { headers, data: { lguId } })
				).status()
			).toBe(200);
		await login(page.request, staff);
		await login(other, second);
		await login(municipal, local);
		await login(sender, caller);
		const payload = { ...sos(caller.profileId), latitude: 14.5, longitude: 120.5 };
		const created = await sender.post('/api/incidents', { headers, data: payload });
		expect(created.status()).toBe(201);
		const incident = (await created.json()).incident;
		expect(incident).toMatchObject({
			lguId: province,
			provincialWorkflow: true,
			suggestedLguId: municipality.id,
			suggestionReason: 'gps'
		});
		expect(
			(await (await sender.post('/api/incidents', { headers, data: payload })).json()).incident.id
		).toBe(incident.id);
		const endpoint = `/api/staff/incidents/${incident.id}`;
		expect((await municipal.get(endpoint)).status()).toBe(404);
		expect(
			(
				await municipal.post(`${endpoint}/confirm`, { headers, data: { verballyConfirmed: true } })
			).status()
		).toBe(404);
		expect(
			(await municipal.get(`/api/staff/incidents?search=${incident.reference}`)).status()
		).toBe(200);
		expect(
			(await (await municipal.get(`/api/staff/incidents?search=${incident.reference}`)).json())
				.total
		).toBe(0);
		for (const [client, path, data] of [
			[admin, `/api/admin/incidents/${incident.id}/lgu`, { lguId: municipality.id }],
			[
				page.request,
				`${endpoint}/lgu`,
				{ lguId: municipality.id, expectedLguId: province, verballyConfirmed: true }
			]
		] as const)
			expect((await client.put(path, { headers, data })).status()).toBe(409);
		expect((await (await page.request.get(endpoint)).json()).medical).toBeNull();
		await page.goto('/dispatch');
		await page.getByRole('button', { name: new RegExp(incident.reference) }).click();
		await expect(
			page.getByRole('heading', { name: 'Provincial dispatch', exact: true })
		).toBeVisible();
		await expect(
			page.getByRole('region', { name: 'Provincial coordination', exact: true })
		).toContainText('Provincial dispatcher keeps this case');
		await expect(
			page.getByRole('button', { name: 'Assign to municipal dispatch', exact: true })
		).toHaveCount(0);
		await expect(page.getByText(privateMedical, { exact: true })).toHaveCount(0);
		await page.getByRole('checkbox', { name: /I verbally confirmed/ }).check();
		await page.getByRole('button', { name: 'Confirm caller and handle case', exact: true }).click();
		await page.getByRole('button', { name: 'Medical information', exact: true }).click();
		await expect(page.getByText(privateMedical, { exact: true })).toBeVisible();
		expect((await (await other.get(endpoint)).json()).medical).toBeNull();
		expect((await (await admin.get(endpoint)).json()).medical).toBeNull();
		expect(
			(
				await other.post(`${endpoint}/confirm`, { headers, data: { verballyConfirmed: true } })
			).status()
		).toBe(409);
		expect(
			(await other.post(`${endpoint}/notes`, { headers, data: { notes: 'Not my case.' } })).status()
		).toBe(403);
		await page.getByRole('button', { name: 'Additional information', exact: true }).click();
		await page
			.getByRole('textbox', { name: 'Additional information', exact: true })
			.fill(
				'Called municipal operations on their official hotline. Shared only location, symptoms and necessary assistance. Acknowledged by the duty officer.'
			);
		await expect(page.getByText('Notes saved', { exact: true })).toBeVisible();
		expect(
			(await page.request.patch(endpoint, { headers, data: { status: 'On route' } })).status()
		).toBe(422);
		expect(
			(
				await page.request.patch(endpoint, {
					headers,
					data: { status: 'On route', source: ' ', details: ' ' }
				})
			).status()
		).toBe(422);
		const confirmation = {
			status: 'On route',
			source: 'Municipal duty officer',
			details: 'Ambulance departed. Confirmed by radio.'
		};
		expect((await other.patch(endpoint, { headers, data: confirmation })).status()).toBe(403);
		const db = database();
		try {
			db.exec(
				"CREATE TRIGGER fail_provincial_progress BEFORE INSERT ON incident_event WHEN NEW.type='on_route' BEGIN SELECT RAISE(ABORT,'isolated progress rollback'); END"
			);
			expect((await page.request.patch(endpoint, { headers, data: confirmation })).status()).toBe(
				500
			);
			expect(db.prepare('SELECT status FROM incident WHERE id=?').get(incident.id)).toEqual({
				status: 'In progress'
			});
		} finally {
			db.exec('DROP TRIGGER fail_provincial_progress');
			db.close();
		}
		const progress = page.getByRole('region', { name: 'Confirmed response updates', exact: true });
		await progress.getByLabel('Confirmed status', { exact: false }).selectOption('On route');
		await expect(
			progress.getByRole('button', { name: 'Save confirmed update', exact: true })
		).toBeDisabled();
		await progress.getByLabel('Update confirmed by', { exact: false }).fill(confirmation.source);
		await progress
			.getByLabel('Confirmed update / outcome', { exact: false })
			.fill(confirmation.details);
		await progress.getByRole('button', { name: 'Save confirmed update', exact: true }).click();
		await expect(progress).toContainText('Ambulance departed. Confirmed by radio.');
		expect((await (await page.request.get(endpoint)).json()).incident).toMatchObject({
			lguId: province,
			dispatcherUserId: staff.id,
			status: 'On route'
		});
		expect(
			(await page.request.get(`/api/staff/reports/${incident.id}/summary/preview`)).status()
		).toBe(200);
		expect((await other.get(`/api/staff/reports/${incident.id}/summary/preview`)).status()).toBe(
			404
		);
		await page.goto('/dispatch/reports');
		await page.getByRole('button').filter({ hasText: incident.reference }).click();
		const reportProgress = page.getByRole('region', {
			name: 'Confirmed response updates',
			exact: true
		});
		await reportProgress.getByLabel('Confirmed status', { exact: false }).selectOption('Resolved');
		await reportProgress
			.getByLabel('Update confirmed by', { exact: false })
			.fill('Municipal EMS response lead');
		await reportProgress
			.getByLabel('Confirmed update / outcome', { exact: false })
			.fill('Patient transported; municipal response completed and confirmed by telephone.');
		await reportProgress
			.getByRole('button', { name: 'Save confirmed update', exact: true })
			.click();
		await expect(reportProgress).toContainText(
			'Patient transported; municipal response completed and confirmed by telephone.'
		);
		await expect(
			reportProgress.getByRole('button', { name: 'Save confirmed update', exact: true })
		).toHaveCount(0);
		const report = await (await page.request.get(`/api/staff/reports/${incident.id}`)).json();
		expect(report.incident).toMatchObject({
			lguId: province,
			dispatcherUserId: staff.id,
			status: 'Resolved'
		});
		expect(report.responseUpdates).toHaveLength(2);
		expect((await municipal.get(`/api/staff/reports/${incident.id}`)).status()).toBe(404);
		expect(
			(
				await municipal.get(`/api/staff/reports/export?search=${incident.reference}&status=All`)
			).status()
		).toBe(422);
		const addendum = page.getByLabel('Addendum *', { exact: true });
		await addendum.fill('Outcome confirmed; no full registered profile was forwarded.');
		await page.getByRole('button', { name: 'Save addendum', exact: true }).click();
		await expect(
			page.getByText('Outcome confirmed; no full registered profile was forwarded.', {
				exact: true
			})
		).toBeVisible();
		const pdf = await page.request.get(
			`/api/staff/reports/export?search=${incident.reference}&status=All`
		);
		expect(pdf.status()).toBe(200);
		const loadingTask = getDocument({
			data: new Uint8Array(await pdf.body()),
			useSystemFonts: true
		});
		const document = await loadingTask.promise;
		let pdfText = '';
		for (let number = 1; number <= document.numPages; number++) {
			const content = await (await document.getPage(number)).getTextContent();
			pdfText += content.items.map((item) => ('str' in item ? item.str : '')).join(' ') + ' ';
		}
		await loadingTask.destroy();
		expect(pdfText).toContain('Municipal duty officer');
		expect(pdfText).toContain('Municipal EMS response lead');
		await page.screenshot({
			path: testInfo.outputPath('provincial-case-desktop.png'),
			fullPage: true
		});
		await page.setViewportSize({ width: 390, height: 844 });
		expect(
			await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
		).toBe(true);
		await page.screenshot({
			path: testInfo.outputPath('provincial-case-mobile-light.png'),
			fullPage: true
		});
		await page.getByRole('button', { name: 'Switch to dark mode', exact: true }).click();
		await page.screenshot({
			path: testInfo.outputPath('provincial-case-mobile-dark.png'),
			fullPage: true
		});
		const check = database();
		try {
			expect(
				check
					.prepare('SELECT count(*) AS n FROM lgu_routing_audit WHERE incident_id=?')
					.get(incident.id)
			).toEqual({ n: 0 });
		} finally {
			check.close();
		}
	} finally {
		const db = database();
		try {
			db.prepare('UPDATE lgu SET active=0,activated_at=NULL,boundary=NULL WHERE id=?').run(
				municipality.id
			);
		} finally {
			db.close();
		}
		for (const client of [admin, sender, other, municipal]) await client.dispose();
	}
});

test('provincial claims serialize; confirmed no-response closure and beneficiary cancellation preserve the same owner', async ({
	request,
	playwright
}) => {
	test.setTimeout(180000);
	const staff = [await provision('dispatcher'), await provision('dispatcher')];
	const db = database();
	try {
		for (const actor of staff)
			db.prepare('INSERT INTO staff_lgu (user_id,lgu_id) VALUES (?,?)').run(actor.id, province);
	} finally {
		db.close();
	}
	const [first, second] = await Promise.all(
		staff.map(() => playwright.request.newContext({ baseURL: origin }))
	);
	const beneficiary = await playwright.request.newContext({ baseURL: origin });
	try {
		await login(first, staff[0]);
		await login(second, staff[1]);
		const caller = await provision();
		await login(request, caller);
		const created = await request.post('/api/incidents', { headers, data: sos(caller.profileId) });
		const id = (await created.json()).incident.id;
		const endpoint = `/api/staff/incidents/${id}`;
		const claims = await Promise.all(
			[first, second].map((client) =>
				client.post(`${endpoint}/confirm`, { headers, data: { verballyConfirmed: true } })
			)
		);
		expect(claims.map((row) => row.status()).sort()).toEqual([200, 409]);
		const winner = claims[0].status() === 200 ? first : second;
		expect(
			(
				await winner.patch(endpoint, {
					headers,
					data: {
						status: 'Resolved',
						source: 'Caller and municipal duty officer',
						details: 'Confirmed safe; no emergency response needed.'
					}
				})
			).status()
		).toBe(200);
		const closed = await (await winner.get(endpoint)).json();
		expect(closed.incident.status).toBe('Resolved');
		expect(closed.responseUpdates).toHaveLength(1);
		const person = await provision();
		approveSharingTrust(person.profileId, caller.profileId);
		await login(beneficiary, person);
		const trusted = await request.post('/api/incidents', { headers, data: sos(person.profileId) });
		const trustedId = (await trusted.json()).incident.id;
		const path = `/api/staff/incidents/${trustedId}`;
		expect(
			(await first.post(`${path}/confirm`, { headers, data: { verballyConfirmed: true } })).status()
		).toBe(200);
		expect(
			(
				await beneficiary.post(`/api/incidents/${trustedId}/cancellation`, {
					headers,
					data: { reason: 'I am safe; please confirm.' }
				})
			).status()
		).toBe(200);
		expect(
			(
				await first.patch(path, {
					headers,
					data: { status: 'Resolved', source: 'Caller', details: 'Safe now.' }
				})
			).status()
		).toBe(409);
		expect(
			(
				await second.post(`${path}/cancellation`, { headers, data: { decision: 'approve' } })
			).status()
		).toBe(403);
		expect(
			(
				await first.post(`${path}/cancellation`, { headers, data: { decision: 'approve' } })
			).status()
		).toBe(200);
		expect((await (await first.get(path)).json()).incident).toMatchObject({
			status: 'Resolved',
			dispatcherUserId: staff[0].id,
			lguId: province
		});
	} finally {
		for (const client of [first, second, beneficiary]) await client.dispose();
	}
});
