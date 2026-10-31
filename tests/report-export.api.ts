import { expect, test } from '@playwright/test';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { writeFileSync } from 'node:fs';
import { database, login, origin, provision } from './incident-fixture';

test('filtered reports export every matching page without crossing staff or LGU scope', async ({
	page,
	playwright
}, testInfo) => {
	test.setTimeout(180000);
	const endpoint = '/api/staff/reports/export';
	expect((await page.request.get(endpoint)).status()).toBe(401);
	const civilian = await provision(),
		beneficiary = await provision();
	const central = await provision('admin'),
		local = await provision('admin');
	const handler = await provision('dispatcher'),
		otherHandler = await provision('dispatcher');
	const lgu = crypto.randomUUID(),
		otherLgu = crypto.randomUUID();
	const db = database();
	const references: string[] = [];
	try {
		db.prepare('INSERT INTO lgu (id,name,active) VALUES (?,?,1)').run(lgu, `Export LGU ${lgu}`);
		db.prepare('INSERT INTO lgu (id,name,active) VALUES (?,?,1)').run(
			otherLgu,
			`Export LGU ${otherLgu}`
		);
		for (const staff of [local, handler])
			db.prepare('INSERT INTO staff_lgu (user_id,lgu_id) VALUES (?,?)').run(staff.id, lgu);
		db.prepare('INSERT INTO staff_lgu (user_id,lgu_id) VALUES (?,?)').run(
			otherHandler.id,
			otherLgu
		);
		db.prepare('UPDATE user_profile SET first_name=? WHERE id=?').run('Peña', civilian.profileId);
		function add(
			start: string,
			jurisdiction = lgu,
			dispatcher = handler.id,
			person = civilian.profileId
		) {
			const id = crypto.randomUUID(),
				time = Date.parse(start);
			db.prepare(
				"INSERT INTO incident (id,person_profile_id,caller_user_id,caller_name,dispatcher_user_id,status,latitude,longitude,idempotency_key,created_at,confirmed_at,ended_at) VALUES (?,?,?,?,?,'Resolved',14.5,121.5,?,?,?,?)"
			).run(
				id,
				person,
				civilian.id,
				'Synthetic caller',
				dispatcher,
				crypto.randomUUID(),
				time,
				time,
				time + 99000
			);
			const ref = (
				db.prepare('SELECT number FROM incident_reference WHERE incident_id=?').get(id) as {
					number: number;
				}
			).number;
			db.prepare("INSERT INTO incident_lgu (incident_id,lgu_id,reason) VALUES (?,?,'gps')").run(
				id,
				jurisdiction
			);
			db.prepare(
				"INSERT INTO incident_event (id,incident_id,actor_user_id,type,notes) VALUES (?,?,?,'note',?)"
			).run(
				crypto.randomUUID(),
				id,
				dispatcher,
				'SYNTHETIC-NOTES: Caller needs assistance. ' + 'Saved response details. '.repeat(70)
			);
			db.prepare(
				'INSERT INTO incident_addendum (id,incident_id,actor_user_id,notes) VALUES (?,?,?,?)'
			).run(crypto.randomUUID(), id, dispatcher, 'SYNTHETIC-ADDENDUM: Response completed.');
			return `HL-${String(ref).padStart(7, '0')}`;
		}
		for (let i = 0; i < 22; i++)
			references.push(add(i === 0 ? '2026-10-31T23:59:59+08:00' : '2026-10-31T00:00:00+08:00'));
		add('2026-10-30T23:59:59+08:00');
		add('2026-11-01T00:00:00+08:00');
		add('2026-10-31T12:00:00+08:00', otherLgu, otherHandler.id);
		add('2026-10-31T12:00:00+08:00', lgu, handler.id, beneficiary.profileId);
	} finally {
		db.close();
	}
	const query = new URLSearchParams({
		view: 'reports',
		status: 'Resolved',
		from: '2026-10-31',
		to: '2026-10-31',
		lguId: lgu,
		dispatcherId: handler.id,
		sosType: 'self'
	});
	await login(page.request, civilian);
	expect((await page.request.get(endpoint)).status()).toBe(403);
	await login(page.request, central, false);
	expect((await page.request.get(endpoint)).status()).toBe(403);
	await login(page.request, central);
	const archive = await (await page.request.get(`/api/staff/incidents?${query}`)).json();
	expect(archive.total).toBe(22);
	expect(archive.incidents).toHaveLength(20);
	for (const bad of ['from=2026-02-30', 'from=2026-11-01&to=2026-10-31', 'sosType=invalid'])
		expect((await page.request.get(`${endpoint}?${bad}`)).status()).toBe(422);
	expect((await page.request.get(`${endpoint}?search=NONEXISTENT-REPORT`)).status()).toBe(422);
	const pdf = await page.request.get(`${endpoint}?${query}`);
	expect(pdf.status(), await pdf.text()).toBe(200);
	expect(pdf.headers()['content-type']).toBe('application/pdf');
	expect(pdf.headers()['cache-control']).toContain('no-store');
	const bytes = await pdf.body();
	expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
	const loadingTask = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false });
	const parsed = await loadingTask.promise;
	const firstPage = await (await parsed.getPage(1)).getTextContent();
	const firstPageText = firstPage.items
		.map((item) => ('str' in item ? item.str : ''))
		.join(' ')
		.replace(/\s+/g, ' ')
		.trim();
	expect(firstPageText).toContain(references[0]);
	expect(firstPageText).toContain('Person in distress: Peña Reyes');
	expect(firstPageText).toContain('SYNTHETIC-NOTES');
	const canvasFactory = parsed.canvasFactory as {
		create(
			width: number,
			height: number
		): {
			canvas: HTMLCanvasElement & { toBuffer(mime: string): Buffer };
			context: CanvasRenderingContext2D;
		};
		destroy(canvas: unknown): void;
	};
	let content = '';
	for (let i = 1; i <= parsed.numPages; i++) {
		const page = await parsed.getPage(i);
		const text = await page.getTextContent();
		const pageText = text.items
			.map((item) => ('str' in item ? item.str : ''))
			.join(' ')
			.replace(/\s+/g, ' ')
			.trim();
		expect(pageText).toContain(`Page ${i} of ${parsed.numPages}`);
		expect(pageText).toContain('HANDLINK');
		expect(pageText).toContain('INCIDENT REPORTS | HL-');
		content += pageText + '\n';
	}
	expect(parsed.numPages).toBeGreaterThanOrEqual(22);
	for (const reference of references) expect(content).toContain(reference);
	expect(content).toContain('Peña');
	expect(content).toContain('SYNTHETIC-NOTES');
	expect(content).toContain('SYNTHETIC-ADDENDUM');
	expect(content).toContain('Response duration: 0h 1m 39s');
	expect(content).toContain('11:59:59');
	expect(content).toContain('Incident start date range');
	expect(content).not.toContain('PRIVATE-INCIDENT-ALLERGY');
	// Render representative pages through PDF.js for visual inspection without a system PDF tool.
	for (const number of [1, 2, 3]) {
		const pdfPage = await parsed.getPage(number);
		const viewport = pdfPage.getViewport({ scale: 1 });
		const canvas = canvasFactory.create(viewport.width, viewport.height);
		await pdfPage.render({ canvasContext: canvas.context, viewport, canvas: canvas.canvas })
			.promise;
		writeFileSync(
			testInfo.outputPath(`report-page-${number}.png`),
			canvas.canvas.toBuffer('image/png')
		);
		canvasFactory.destroy(canvas);
	}
	await loadingTask.destroy();
	const scoped = await playwright.request.newContext({ baseURL: origin });
	try {
		await login(scoped, local);
		expect((await scoped.get(`${endpoint}?lguId=${otherLgu}`)).status()).toBe(403);
		const facets = await (await scoped.get('/api/staff/reports/filters')).json();
		expect(facets.lgus.map((row: { id: string }) => row.id)).toEqual([lgu]);
		expect(facets.dispatchers.map((row: { id: string }) => row.id)).not.toContain(otherHandler.id);
		await login(scoped, otherHandler);
		expect((await scoped.get(`${endpoint}?dispatcherId=${handler.id}`)).status()).toBe(422);
	} finally {
		await scoped.dispose();
	}
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/admin/reports');
	await page.getByLabel('From date', { exact: true }).fill('2026-10-31');
	await page.getByLabel('To date', { exact: true }).fill('2026-10-31');
	await page.getByLabel('LGU', { exact: true }).selectOption(lgu);
	await page.getByLabel('Dispatcher', { exact: true }).selectOption(handler.id);
	await page.getByLabel('SOS type', { exact: true }).selectOption('self');
	await page.getByRole('button', { name: 'Apply filters' }).click();
	await expect(page.getByText(/22 reports/)).toBeVisible();
	const download = page.waitForEvent('download');
	await page.getByRole('button', { name: 'Download filtered PDF' }).click();
	expect((await download).suggestedFilename()).toBe('handlink-filtered-reports.pdf');
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
	await page.screenshot({ path: testInfo.outputPath('report-filters-mobile.png'), fullPage: true });
	const extra = database();
	try {
		const original = archive.incidents[0].id;
		for (let i = 0; i < 80; i++) {
			const id = crypto.randomUUID();
			extra
				.prepare(
					'INSERT INTO incident (id,person_profile_id,caller_user_id,caller_name,dispatcher_user_id,status,latitude,longitude,idempotency_key,created_at,confirmed_at,ended_at) SELECT ?,person_profile_id,caller_user_id,caller_name,dispatcher_user_id,status,latitude,longitude,?,created_at,confirmed_at,ended_at FROM incident WHERE id=?'
				)
				.run(id, crypto.randomUUID(), original);
			extra
				.prepare("INSERT INTO incident_lgu (incident_id,lgu_id,reason) VALUES (?,?,'gps')")
				.run(id, lgu);
		}
	} finally {
		extra.close();
	}
	const tooMany = await page.request.get(`${endpoint}?${query}`);
	expect(tooMany.status()).toBe(422);
	expect(await tooMany.text()).toContain('Narrow your filters');
});
