import { expect, test } from '@playwright/test';
import { database, headers, login, origin, password, provision, sos } from './incident-fixture';
import { enrollStaffMfa } from './mfa-fixture';

test('note autosave protects versions; resolved addenda preserve the report and enforce assigned ownership', async ({
	request,
	playwright
}) => {
	test.setTimeout(180000);
	const caller = await provision();
	const assignedAccount = await provision('dispatcher');
	const otherAccount = await provision('dispatcher');
	const administrator = await provision('admin');
	expect((await request.get('/api/admin/dashboard')).status()).toBe(401);
	await login(request, caller);
	expect((await request.get('/api/admin/dashboard')).status()).toBe(403);
	const created = await request.post('/api/incidents', { headers, data: sos(caller.profileId) });
	expect(created.status()).toBe(201);
	const { id } = (await created.json()).incident;
	const contexts = await Promise.all(
		[assignedAccount, otherAccount, administrator].map(() =>
			playwright.request.newContext({ baseURL: origin })
		)
	);
	const [assigned, other, admin] = contexts;
	const db = database();
	try {
		await login(assigned, assignedAccount);
		await login(other, otherAccount);
		await login(admin, administrator, false);
		expect((await admin.get('/api/admin/dashboard')).status()).toBe(403);
		await enrollStaffMfa(admin, password);
		expect((await assigned.get('/api/admin/dashboard')).status()).toBe(403);
		expect(
			(
				await assigned.post(`/api/staff/incidents/${id}/confirm`, {
					headers,
					data: { verballyConfirmed: true }
				})
			).status()
		).toBe(200);
		const notesEndpoint = `/api/staff/incidents/${id}/notes`;
		const addendaEndpoint = `/api/staff/reports/${id}/addenda`;
		const firstText = 'Caller reports chest pain.';
		const first = await assigned.post(notesEndpoint, {
			headers,
			data: { notes: firstText, expectedNoteId: null }
		});
		expect(first.status()).toBe(200);
		const firstDetail = await first.json();
		expect(firstDetail.noteId).toEqual(expect.any(String));
		const noteRows = () =>
			db
				.prepare("SELECT * FROM incident_event WHERE incident_id=? AND type='note' ORDER BY rowid")
				.all(id);
		const firstRows = noteRows();
		expect(firstRows).toHaveLength(1);
		// A stale tab cannot overwrite a more recent note. A retry of the same content stays unique.
		expect(
			(
				await assigned.post(notesEndpoint, {
					headers,
					data: { notes: 'Stale replacement.', expectedNoteId: null }
				})
			).status()
		).toBe(409);
		expect(noteRows()).toEqual(firstRows);
		const retry = await assigned.post(notesEndpoint, {
			headers,
			data: { notes: firstText, expectedNoteId: null }
		});
		expect(retry.status()).toBe(200);
		expect((await retry.json()).noteId).toBe(firstDetail.noteId);
		expect(noteRows()).toEqual(firstRows);
		for (const denied of [other, admin]) {
			expect(
				(
					await denied.post(notesEndpoint, {
						headers,
						data: { notes: 'Unauthorized replacement.', expectedNoteId: firstDetail.noteId }
					})
				).status()
			).toBe(403);
		}
		expect((await other.get(`/api/staff/reports/${id}`)).status()).toBe(404);
		expect(
			(
				await assigned.post(addendaEndpoint, {
					headers,
					data: { id: crypto.randomUUID(), notes: 'Too early.' }
				})
			).status()
		).toBe(409);
		const finalText = 'Caller reports chest pain. Caller remains conscious.';
		const saved = await assigned.post(notesEndpoint, {
			headers,
			data: { notes: finalText, expectedNoteId: firstDetail.noteId }
		});
		expect(saved.status()).toBe(200);
		const finalDetail = await saved.json();
		expect(finalDetail.noteId).not.toBe(firstDetail.noteId);
		expect(noteRows()).toHaveLength(2);
		for (const status of ['On route', 'Resolved']) {
			expect(
				(await assigned.patch(`/api/staff/incidents/${id}`, { headers, data: { status } })).status()
			).toBe(200);
		}
		expect(
			(
				await assigned.post(notesEndpoint, {
					headers,
					data: { notes: 'Late edit.', expectedNoteId: finalDetail.noteId }
				})
			).status()
		).toBe(409);
		// Seed an already approved AI result without contacting any model or external service.
		const aiId = crypto.randomUUID();
		const reportId = crypto.randomUUID();
		const now = Date.now();
		db.prepare(
			"INSERT INTO ai_summary_request (id,incident_id,requested_by_user_id,source_note_id,input_hash,model,status,summary,created_at,finished_at,reviewed_at,reviewed_by_user_id) VALUES (?,?,?,?,?,?,'completed',?,?,?,?,?)"
		).run(
			aiId,
			id,
			assignedAccount.id,
			finalDetail.noteId,
			'a'.repeat(64),
			'isolated-test-model',
			firstText,
			now,
			now,
			now,
			assignedAccount.id
		);
		db.prepare(
			'INSERT INTO report (id,incident_id,summary,reviewed_by_user_id,reviewed_at,summary_request_id) VALUES (?,?,?,?,?,?)'
		).run(reportId, id, firstText, assignedAccount.id, now, aiId);
		const snapshot = () => ({
			incident: db.prepare('SELECT * FROM incident WHERE id=?').get(id),
			events: db.prepare('SELECT * FROM incident_event WHERE incident_id=? ORDER BY rowid').all(id),
			ai: db.prepare('SELECT * FROM ai_summary_request WHERE id=?').get(aiId),
			report: db.prepare('SELECT * FROM report WHERE id=?').get(reportId)
		});
		const original = snapshot();
		const addendum = { id: crypto.randomUUID(), notes: 'Follow-up received after resolution.' };
		const beforeAddendum = Date.now();
		const appended = await assigned.post(addendaEndpoint, { headers, data: addendum });
		expect(appended.status()).toBe(200);
		const report = await appended.json();
		expect(report.notes).toBe(finalText);
		expect(report.incident.status).toBe('Resolved');
		expect(report.addenda).toHaveLength(1);
		expect(report.addenda[0]).toMatchObject({
			...addendum,
			actorUserId: assignedAccount.id,
			authorName: 'Casey Reyes'
		});
		expect(Date.parse(report.addenda[0].createdAt)).toBeGreaterThanOrEqual(beforeAddendum);
		expect(Date.parse(report.addenda[0].createdAt)).toBeLessThanOrEqual(Date.now());
		const repeat = await assigned.post(addendaEndpoint, { headers, data: addendum });
		expect(repeat.status()).toBe(200);
		expect((await repeat.json()).addenda).toEqual(report.addenda);
		expect(
			db.prepare('SELECT count(*) AS n FROM incident_addendum WHERE incident_id=?').get(id)
		).toEqual({ n: 1 });
		expect(
			(
				await assigned.post(addendaEndpoint, {
					headers,
					data: { ...addendum, notes: 'Changed retry.' }
				})
			).status()
		).toBe(409);
		const adminRead = await admin.get(`/api/staff/reports/${id}`);
		expect(adminRead.status()).toBe(200);
		expect(adminRead.headers()['cache-control']).toBe('no-store');
		expect((await adminRead.json()).addenda).toEqual(report.addenda);
		expect(
			(
				await admin.post(addendaEndpoint, {
					headers,
					data: { id: crypto.randomUUID(), notes: 'Admin cannot append.' }
				})
			).status()
		).toBe(403);
		expect(
			(
				await other.post(addendaEndpoint, {
					headers,
					data: { id: crypto.randomUUID(), notes: 'Other dispatcher cannot append.' }
				})
			).status()
		).toBe(404);
		expect((await other.get(`/api/staff/reports/${id}`)).status()).toBe(404);
		expect(
			(
				await assigned.patch(addendaEndpoint, {
					headers,
					data: { ...addendum, notes: 'Cannot replace.' }
				})
			).status()
		).toBe(405);
		expect((await assigned.delete(addendaEndpoint, { headers })).status()).toBe(405);
		const second = { id: crypto.randomUUID(), notes: 'A second separately dated follow-up.' };
		expect((await assigned.post(addendaEndpoint, { headers, data: second })).status()).toBe(200);
		const all = (await (await assigned.get(`/api/staff/reports/${id}`)).json()).addenda;
		expect(all).toHaveLength(2);
		expect(all.find((entry: { id: string }) => entry.id === addendum.id)).toEqual(
			report.addenda[0]
		);
		expect(snapshot()).toEqual(original);
		// More than one page of accounts/incidents catches dashboard implementations based on list-page lengths.
		const insertUser = db.prepare(
			'INSERT INTO user (id,name,email,email_verified,role,banned,updated_at) VALUES (?,?,?,?,?,?,?)'
		);
		for (let index = 0; index < 25; index++) {
			const accountId = crypto.randomUUID();
			insertUser.run(
				accountId,
				'Dashboard fixture',
				`${accountId}@example.com`,
				index % 2,
				'user',
				index % 3 === 0 ? 1 : 0,
				now
			);
			db.prepare(
				"INSERT INTO incident (id,person_profile_id,caller_user_id,caller_name,latitude,longitude,idempotency_key) VALUES (?,?,?,'Dashboard fixture',14,121,?)"
			).run(crypto.randomUUID(), caller.profileId, caller.id, crypto.randomUUID());
		}
		const metricsResponse = await admin.get('/api/admin/dashboard');
		expect(metricsResponse.status()).toBe(200);
		expect(metricsResponse.headers()['cache-control']).toBe('no-store');
		const metrics = await metricsResponse.json();
		const scalar = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
		expect(metrics).toMatchObject({
			users: scalar("SELECT count(*) AS n FROM user WHERE coalesce(role,'user')='user'"),
			dispatchers: scalar("SELECT count(*) AS n FROM user WHERE role='dispatcher'"),
			admins: scalar("SELECT count(*) AS n FROM user WHERE role='admin'"),
			activeAccounts: scalar(
				'SELECT count(*) AS n FROM user WHERE email_verified=1 AND (banned=0 OR banned IS NULL)'
			),
			unassigned: scalar("SELECT count(*) AS n FROM incident WHERE status='Not assigned'"),
			inProgress: scalar("SELECT count(*) AS n FROM incident WHERE status='In progress'"),
			onRoute: scalar("SELECT count(*) AS n FROM incident WHERE status='On route'"),
			resolved: scalar("SELECT count(*) AS n FROM incident WHERE status='Resolved'")
		});
		expect(metrics.users).toBeGreaterThan(20);
		expect(metrics.unassigned).toBeGreaterThan(20);
		expect(Number.isFinite(Date.parse(metrics.updatedAt))).toBe(true);
	} finally {
		db.close();
		for (const context of contexts) await context.dispose();
	}
});
