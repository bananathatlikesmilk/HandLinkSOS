import { expect, test, type APIRequestContext } from '@playwright/test';
import {
	database,
	headers,
	login,
	origin,
	privateMedical,
	provision,
	sos
} from './incident-fixture';
import { invitation } from './trusted-fixture';

function trust(owner: string, requester: string) {
	const db = database();
	try {
		db.prepare(
			"INSERT INTO trusted_connection (id,owner_profile_id,requester_profile_id,relationship,status,approved_at) VALUES (?,?,?,'Sibling','approved',?)"
		).run(crypto.randomUUID(), owner, requester, Date.now());
	} finally {
		db.close();
	}
}
async function confirm(request: APIRequestContext, id: string) {
	expect(
		(
			await request.post(`/api/staff/incidents/${id}/confirm`, {
				headers,
				data: { verballyConfirmed: true }
			})
		).status()
	).toBe(200);
}

test('beneficiary notices stay private and unique; assigned dispatcher alone decides cancellation', async ({
	request,
	playwright
}) => {
	test.setTimeout(120000);
	expect((await request.get('/api/notifications')).status()).toBe(401);
	const caller = await provision(),
		person = await provision();
	const beneficiary = await playwright.request.newContext({ baseURL: origin });
	const staff = await playwright.request.newContext({ baseURL: origin });
	const other = await playwright.request.newContext({ baseURL: origin });
	const admin = await playwright.request.newContext({ baseURL: origin });
	try {
		await login(request, caller);
		await login(beneficiary, person);
		await login(staff, await provision('dispatcher'));
		await login(other, await provision('dispatcher'));
		await login(admin, await provision('admin'));
		trust(person.profileId, caller.profileId);
		const input = sos(person.profileId);
		const created = await Promise.all([
			request.post('/api/incidents', { headers, data: input }),
			request.post('/api/incidents', { headers, data: input })
		]);
		expect(created.map((r) => r.status()).sort()).toEqual([200, 201]);
		const id = (await created[0].json()).incident.id;
		const reference = (await created[0].json()).incident.reference;
		const notices = await (await beneficiary.get('/api/notifications')).json();
		expect(notices).toMatchObject({ total: 1, unreadCount: 1 });
		expect(notices.notifications[0]).toMatchObject({
			incidentId: id,
			incidentReference: reference
		});
		expect(JSON.stringify(notices)).not.toContain(privateMedical);
		expect(notices.notifications[0]).not.toHaveProperty('callerPhone');
		expect((await (await request.get('/api/notifications')).json()).total).toBe(0);
		expect((await admin.get('/api/notifications')).status()).toBe(403);
		const notice = notices.notifications[0].id;
		expect(
			(await request.post(`/api/notifications/${notice}/read`, { headers, data: {} })).status()
		).toBe(404);
		expect(
			(await beneficiary.post(`/api/notifications/${notice}/read`, { headers, data: {} })).status()
		).toBe(200);
		expect(
			(
				await beneficiary.post(`/api/incidents/${id}/cancellation`, {
					headers: { Origin: 'https://attacker.example' },
					data: { reason: 'Safe now' }
				})
			).status()
		).toBe(403);
		for (const data of [
			{ reason: '' },
			{ reason: 'x'.repeat(501) },
			{ reason: 'Safe', decision: 'approved' }
		])
			expect(
				(await beneficiary.post(`/api/incidents/${id}/cancellation`, { headers, data })).status()
			).toBe(422);
		expect(
			(
				await request.post(`/api/incidents/${id}/cancellation`, {
					headers,
					data: { reason: 'Safe' }
				})
			).status()
		).toBe(403);
		const data = { reason: 'I am safe; please check with me.' };
		expect(
			(await beneficiary.post(`/api/incidents/${id}/cancellation`, { headers, data })).status()
		).toBe(200);
		expect(
			(await beneficiary.post(`/api/incidents/${id}/cancellation`, { headers, data })).status()
		).toBe(200);
		expect((await (await request.get('/api/incidents')).json()).incidents[0]).toMatchObject({
			status: 'Not assigned',
			cancellationPending: true
		});
		expect((await (await staff.get(`/api/staff/incidents/${id}`)).json()).cancellation).toBeNull();
		expect(
			(
				await staff.post(`/api/staff/incidents/${id}/cancellation`, {
					headers,
					data: { decision: 'approve' }
				})
			).status()
		).toBe(403);
		await confirm(staff, id);
		for (const ctx of [other, admin])
			expect(
				(
					await ctx.post(`/api/staff/incidents/${id}/cancellation`, {
						headers,
						data: { decision: 'approve' }
					})
				).status()
			).toBe(403);
		expect((await other.get(`/api/staff/reports/${id}`)).status()).toBe(404);
		const results = await Promise.all(
			['approve', 'reject'].map((decision) =>
				staff.post(`/api/staff/incidents/${id}/cancellation`, { headers, data: { decision } })
			)
		);
		expect(results.map((r) => r.status()).sort()).toEqual([200, 409]);
		const winner = await results.find((r) => r.status() === 200)!.json();
		const report = await (await staff.get(`/api/staff/reports/${id}`)).json();
		expect(report.incident.status).toBe(
			winner.cancellation.decision === 'approved' ? 'Resolved' : 'In progress'
		);
		expect(Boolean(report.incident.endedAt)).toBe(winner.cancellation.decision === 'approved');
		expect((await (await beneficiary.get('/api/notifications')).json()).unreadCount).toBe(1);
		expect(
			(await beneficiary.post(`/api/incidents/${id}/cancellation`, { headers, data })).status()
		).toBe(409);
	} finally {
		await Promise.all([beneficiary.dispose(), staff.dispose(), other.dispose(), admin.dispose()]);
	}
});

test('pending review blocks normal resolution; rejection preserves response; approval closes it', async ({
	request,
	playwright
}) => {
	test.setTimeout(90000);
	const caller = await provision(),
		person = await provision();
	await login(request, caller);
	trust(person.profileId, caller.profileId);
	const beneficiary = await playwright.request.newContext({ baseURL: origin }),
		staff = await playwright.request.newContext({ baseURL: origin });
	try {
		await login(beneficiary, person);
		await login(staff, await provision('dispatcher'));
		for (const decision of ['reject', 'approve']) {
			const id = (
				await (
					await request.post('/api/incidents', { headers, data: sos(person.profileId) })
				).json()
			).incident.id;
			await confirm(staff, id);
			expect(
				(
					await staff.patch(`/api/staff/incidents/${id}`, { headers, data: { status: 'On route' } })
				).status()
			).toBe(200);
			expect(
				(
					await beneficiary.post(`/api/incidents/${id}/cancellation`, {
						headers,
						data: { reason: 'Safe now' }
					})
				).status()
			).toBe(200);
			expect(
				(
					await staff.patch(`/api/staff/incidents/${id}`, { headers, data: { status: 'Resolved' } })
				).status()
			).toBe(409);
			expect(
				(
					await staff.post(`/api/staff/incidents/${id}/cancellation`, {
						headers,
						data: { decision }
					})
				).status()
			).toBe(200);
			const report = await (await staff.get(`/api/staff/reports/${id}`)).json();
			expect(report.incident.status).toBe(decision === 'approve' ? 'Resolved' : 'On route');
			if (decision === 'reject')
				expect(
					(
						await staff.patch(`/api/staff/incidents/${id}`, {
							headers,
							data: { status: 'Resolved' }
						})
					).status()
				).toBe(200);
		}
		const self = await request.post('/api/incidents', { headers, data: sos(caller.profileId) });
		expect(self.status()).toBe(201);
		expect((await (await request.get('/api/notifications')).json()).total).toBe(0);
	} finally {
		await beneficiary.dispose();
		await staff.dispose();
	}
});

test('mutual approval needs separate consent and cannot resurrect a removed reverse request', async ({
	request,
	playwright
}) => {
	test.setTimeout(90000);
	const owner = await provision(),
		scanner = await provision();
	await login(request, owner);
	const other = await playwright.request.newContext({ baseURL: origin });
	try {
		await login(other, scanner);
		const qr = await invitation(request, owner.id);
		const connection = (
			await (
				await other.post('/api/trusted/scan', {
					headers,
					data: { token: qr.token, relationship: 'Sibling' }
				})
			).json()
		).connection;
		const path = `/api/trusted/${connection.id}`;
		const approve = { action: 'approve', invitationId: qr.invitationId, requestMutual: true };
		expect((await request.patch(path, { headers, data: approve })).status()).toBe(422);
		expect(
			(
				await other.patch(path, { headers, data: { ...approve, mutualRelationship: 'Sibling' } })
			).status()
		).toBe(403);
		const failing = database();
		try {
			failing.exec(
				`CREATE TRIGGER fail_test_reverse BEFORE INSERT ON trusted_connection WHEN NEW.owner_profile_id='${scanner.profileId}' BEGIN SELECT RAISE(ABORT,'test reverse failure'); END;`
			);
			expect(
				(
					await request.patch(path, {
						headers,
						data: { ...approve, mutualRelationship: 'Sibling' }
					})
				).status()
			).toBe(500);
			expect(
				failing.prepare('SELECT status FROM trusted_connection WHERE id=?').get(connection.id)
			).toEqual({ status: 'pending' });
		} finally {
			failing.exec('DROP TRIGGER IF EXISTS fail_test_reverse');
			failing.close();
		}
		const result = await request.patch(path, {
			headers,
			data: { ...approve, mutualRelationship: 'Sibling' }
		});
		expect(result.status()).toBe(200);
		const reverse = (await result.json()).mutualRequest;
		expect(reverse.status).toBe('pending');
		expect(
			(await request.post('/api/incidents', { headers, data: sos(scanner.profileId) })).status()
		).toBe(403);
		expect(
			(
				await other.patch(`/api/trusted/${reverse.id}`, {
					headers,
					data: { action: 'approve', invitationId: reverse.invitationId }
				})
			).status()
		).toBe(200);
		expect(
			(await request.post('/api/incidents', { headers, data: sos(scanner.profileId) })).status()
		).toBe(201);
		expect(
			(
				await other.patch(`/api/trusted/${reverse.id}`, { headers, data: { action: 'revoke' } })
			).status()
		).toBe(200);
		expect(
			(
				await request.patch(path, { headers, data: { ...approve, mutualRelationship: 'Sibling' } })
			).status()
		).toBe(200);
		const db = database();
		try {
			expect(
				db.prepare('SELECT status FROM trusted_connection WHERE id=?').get(reverse.id)
			).toEqual({ status: 'revoked' });
		} finally {
			db.close();
		}
	} finally {
		await other.dispose();
	}
});

test('notification and cancellation audit failures roll back complete transactions', async ({
	request,
	playwright
}) => {
	test.setTimeout(90000);
	const caller = await provision(),
		person = await provision();
	await login(request, caller);
	trust(person.profileId, caller.profileId);
	const beneficiary = await playwright.request.newContext({ baseURL: origin });
	const staff = await playwright.request.newContext({ baseURL: origin });
	const db = database();
	try {
		await login(beneficiary, person);
		await login(staff, await provision('dispatcher'));
		db.exec(
			`CREATE TRIGGER fail_test_notification BEFORE INSERT ON notification WHEN NEW.user_id='${person.id}' BEGIN SELECT RAISE(ABORT,'test notification failure'); END;`
		);
		expect(
			(await request.post('/api/incidents', { headers, data: sos(person.profileId) })).status()
		).toBe(500);
		expect(
			db.prepare('SELECT count(*) n FROM incident WHERE caller_user_id=?').get(caller.id)
		).toEqual({ n: 0 });
		db.exec('DROP TRIGGER fail_test_notification');
		const id = (
			await (await request.post('/api/incidents', { headers, data: sos(person.profileId) })).json()
		).incident.id;
		db.exec(
			`CREATE TRIGGER fail_test_cancel BEFORE INSERT ON incident_event WHEN NEW.incident_id='${id}' AND NEW.type='cancellation_requested' BEGIN SELECT RAISE(ABORT,'test audit failure'); END;`
		);
		expect(
			(
				await beneficiary.post(`/api/incidents/${id}/cancellation`, {
					headers,
					data: { reason: 'Safe' }
				})
			).status()
		).toBe(500);
		expect(
			db.prepare('SELECT count(*) n FROM incident_cancellation WHERE incident_id=?').get(id)
		).toEqual({ n: 0 });
		db.exec('DROP TRIGGER fail_test_cancel');
		expect(
			(
				await beneficiary.post(`/api/incidents/${id}/cancellation`, {
					headers,
					data: { reason: 'Safe' }
				})
			).status()
		).toBe(200);
		await confirm(staff, id);
		const notice = (await (await beneficiary.get('/api/notifications')).json()).notifications[0].id;
		await beneficiary.post(`/api/notifications/${notice}/read`, { headers, data: {} });
		db.exec(
			`CREATE TRIGGER fail_test_review BEFORE INSERT ON incident_event WHEN NEW.incident_id='${id}' AND NEW.type='cancellation_approved' BEGIN SELECT RAISE(ABORT,'test review failure'); END;`
		);
		expect(
			(
				await staff.post(`/api/staff/incidents/${id}/cancellation`, {
					headers,
					data: { decision: 'approve' }
				})
			).status()
		).toBe(500);
		expect(
			db
				.prepare('SELECT decision,reviewed_at FROM incident_cancellation WHERE incident_id=?')
				.get(id)
		).toEqual({ decision: 'pending', reviewed_at: null });
		expect(db.prepare('SELECT status,ended_at FROM incident WHERE id=?').get(id)).toEqual({
			status: 'In progress',
			ended_at: null
		});
		expect((await (await beneficiary.get('/api/notifications')).json()).unreadCount).toBe(0);
	} finally {
		db.exec(
			'DROP TRIGGER IF EXISTS fail_test_notification; DROP TRIGGER IF EXISTS fail_test_cancel; DROP TRIGGER IF EXISTS fail_test_review;'
		);
		db.close();
		await beneficiary.dispose();
		await staff.dispose();
	}
});
