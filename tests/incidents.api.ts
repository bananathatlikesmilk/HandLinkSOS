import { expect, test } from '@playwright/test';
import {
	database,
	headers,
	login,
	origin,
	privateMedical,
	provision,
	sos
} from './incident-fixture';
import { enrollStaffMfa } from './mfa-fixture';
import { password } from './incident-fixture';

test('SOS favorites are persistent, requester-scoped and restricted to approved active profiles', async ({
	request,
	playwright
}) => {
	const caller = await provision(),
		person = await provision(),
		other = await provision();
	const endpoint = `/api/incidents/targets/${person.profileId}/favorite`;
	expect((await request.put(endpoint, { headers, data: { favorite: true } })).status()).toBe(401);
	const db = database();
	try {
		for (const requester of [caller, other])
			db.prepare(
				"INSERT INTO trusted_connection (id,owner_profile_id,requester_profile_id,relationship,status,approved_at) VALUES (?,?,?,'Friend','approved',?)"
			).run(crypto.randomUUID(), person.profileId, requester.profileId, Date.now());
	} finally {
		db.close();
	}
	await login(request, caller);
	expect((await request.put(endpoint, { data: { favorite: true } })).status()).toBe(403);
	expect((await request.put(endpoint, { headers, data: { favorite: 'yes' } })).status()).toBe(422);
	expect(
		(
			await request.put(endpoint, {
				headers,
				data: { favorite: true, requesterProfileId: other.profileId }
			})
		).status()
	).toBe(422);
	for (let i = 0; i < 2; i++)
		expect((await request.put(endpoint, { headers, data: { favorite: true } })).status()).toBe(200);
	const people = await (await request.get('/api/incidents/targets')).json();
	expect(
		people.targets.find((target: { id: string }) => target.id === person.profileId).favorite
	).toBe(true);
	const context = await playwright.request.newContext({ baseURL: origin });
	try {
		await login(context, other);
		const ownPeople = await (await context.get('/api/incidents/targets')).json();
		expect(
			ownPeople.targets.find((target: { id: string }) => target.id === person.profileId).favorite
		).toBe(false);
		expect(
			(
				await context.put(`/api/incidents/targets/${caller.profileId}/favorite`, {
					headers,
					data: { favorite: true }
				})
			).status()
		).toBe(404);
	} finally {
		await context.dispose();
	}
	const check = database();
	try {
		check
			.prepare(
				"UPDATE trusted_connection SET status='revoked',revoked_at=? WHERE requester_profile_id=? AND owner_profile_id=?"
			)
			.run(Date.now(), caller.profileId, person.profileId);
	} finally {
		check.close();
	}
	expect((await request.put(endpoint, { headers, data: { favorite: false } })).status()).toBe(404);
	const remaining = await (await request.get('/api/incidents/targets')).json();
	expect(remaining.targets.some((target: { id: string }) => target.id === person.profileId)).toBe(
		false
	);
});

test('SOS endpoints enforce sessions, roles, MFA, same origin, and strict inputs', async ({
	request,
	playwright
}) => {
	test.setTimeout(90000);
	expect((await request.get('/api/incidents')).status()).toBe(401);
	expect((await request.get('/api/staff/incidents')).status()).toBe(401);
	expect((await request.get(`/api/staff/reports/${crypto.randomUUID()}`)).status()).toBe(401);
	const caller = await provision();
	await login(request, caller);
	expect((await request.get('/api/staff/incidents')).status()).toBe(403);
	expect((await request.get(`/api/staff/reports/${crypto.randomUUID()}`)).status()).toBe(403);
	const input = sos(caller.profileId);
	for (const invalid of [
		{ ...input, callerUserId: 'other' },
		{ ...input, status: 'Resolved' },
		{ ...input, reference: 'HL-0000001' },
		{ ...input, latitude: 91 },
		{ ...input, idempotencyKey: 'bad' },
		{ ...input, locationLabel: 'x'.repeat(251) }
	])
		expect((await request.post('/api/incidents', { headers, data: invalid })).status()).toBe(422);
	expect(
		(
			await request.post('/api/incidents', {
				headers: { Origin: 'https://attacker.example' },
				data: input
			})
		).status()
	).toBe(403);
	const staff = await provision('dispatcher');
	const context = await playwright.request.newContext({ baseURL: origin });
	try {
		await login(context, staff, false);
		expect((await context.get('/api/staff/incidents')).status()).toBe(403);
		await enrollStaffMfa(context, password);
		expect((await context.get('/api/staff/incidents')).status()).toBe(200);
		expect((await context.post('/api/incidents', { headers, data: input })).status()).toBe(403);
		const db = database();
		try {
			db.prepare('DELETE FROM session WHERE user_id=?').run(staff.id);
		} finally {
			db.close();
		}
		expect((await context.get('/api/staff/incidents')).status()).toBe(401);
	} finally {
		await context.dispose();
	}
});

test('SOS retries stay unique and trusted SOS requires approved permission in the correct direction', async ({
	request,
	playwright
}) => {
	test.setTimeout(90000);
	const caller = await provision();
	const person = await provision();
	await login(request, caller);
	const input = sos(caller.profileId);
	const responses = await Promise.all([
		request.post('/api/incidents', { headers, data: input }),
		request.post('/api/incidents', { headers, data: input })
	]);
	expect(responses.map((r) => r.status()).sort()).toEqual([200, 201]);
	const firstIncident = (await responses[0].json()).incident;
	const { id, reference } = firstIncident;
	expect(reference).toMatch(/^HL-\d{7,}$/);
	expect((await responses[1].json()).incident).toMatchObject({ id, reference });
	expect(
		(await request.post('/api/incidents', { headers, data: { ...input, latitude: 15 } })).status()
	).toBe(409);
	expect(
		(await request.post('/api/incidents', { headers, data: sos(caller.profileId) })).status()
	).toBe(409);
	const other = await playwright.request.newContext({ baseURL: origin });
	try {
		await login(other, person);
		expect((await (await other.get('/api/incidents')).json()).incidents).toEqual([]);
		expect((await other.get(`/api/staff/incidents/${id}`)).status()).toBe(403);
	} finally {
		await other.dispose();
	}
	const trusted = sos(person.profileId);
	expect((await request.post('/api/incidents', { headers, data: trusted })).status()).toBe(403);
	const db = database();
	try {
		const connectionId = crypto.randomUUID();
		db.prepare(
			'INSERT INTO trusted_connection (id,owner_profile_id,requester_profile_id,relationship) VALUES (?,?,?,?)'
		).run(connectionId, person.profileId, caller.profileId, 'Sibling');
		expect((await request.post('/api/incidents', { headers, data: trusted })).status()).toBe(403);
		db.prepare("UPDATE trusted_connection SET status='approved',approved_at=? WHERE id=?").run(
			Date.now(),
			connectionId
		);
		expect(
			(await (await request.get('/api/incidents/targets')).json()).targets.map((t) => t.id)
		).toContain(person.profileId);
		// The owner has not received reciprocal permission to send SOS for the requester.
		const reverse = await playwright.request.newContext({ baseURL: origin });
		try {
			await login(reverse, person);
			expect(
				(await reverse.post('/api/incidents', { headers, data: sos(caller.profileId) })).status()
			).toBe(403);
		} finally {
			await reverse.dispose();
		}
		const created = await request.post('/api/incidents', { headers, data: trusted });
		expect(created.status()).toBe(201);
		expect(
			db
				.prepare('SELECT caller_name,caller_relationship FROM incident WHERE id=?')
				.get((await created.json()).incident.id)
		).toMatchObject({ caller_name: 'Casey Reyes', caller_relationship: 'Sibling' });
		db.prepare("UPDATE trusted_connection SET status='revoked',revoked_at=? WHERE id=?").run(
			Date.now(),
			connectionId
		);
		expect(
			(await (await request.get('/api/incidents/targets')).json()).targets.map((t) => t.id)
		).not.toContain(person.profileId);
		expect(
			(await request.post('/api/incidents', { headers, data: sos(person.profileId) })).status()
		).toBe(403);
		expect(
			db
				.prepare("SELECT count(*) AS n FROM incident_event WHERE incident_id=? AND type='created'")
				.get(id)
		).toMatchObject({ n: 1 });
	} finally {
		db.close();
	}
});

test('one dispatcher wins confirmation; private details and transitions stay assigned and audit timestamps persist', async ({
	request,
	playwright
}) => {
	test.setTimeout(120000);
	const caller = await provision();
	await login(request, caller);
	const submitted = await request.post('/api/incidents', { headers, data: sos(caller.profileId) });
	const { id, reference } = (await submitted.json()).incident;
	const first = await provision('dispatcher'),
		second = await provision('dispatcher'),
		admin = await provision('admin');
	const contexts = await Promise.all(
		[first, second, admin].map(() => playwright.request.newContext({ baseURL: origin }))
	);
	try {
		for (let i = 0; i < contexts.length; i++) await login(contexts[i], [first, second, admin][i]);
		const [a, b, manager] = contexts;
		expect((await a.get(`/api/staff/reports/${id}`)).status()).toBe(404);
		const queue = await a.get('/api/staff/incidents');
		expect(queue.headers()['cache-control']).toBe('no-store');
		expect(await queue.text()).not.toContain(privateMedical);
		const byReference = await (
			await a.get(`/api/staff/incidents?search=${reference.toLowerCase()}`)
		).json();
		expect(byReference).toMatchObject({ total: 1 });
		expect(byReference.incidents[0]).toMatchObject({ id, reference });
		expect(await (await a.get(`/api/staff/incidents/${id}`)).json()).toMatchObject({
			personal: null,
			medical: null,
			emergencyContacts: [],
			events: []
		});
		expect(
			(
				await a.post(`/api/staff/incidents/${id}/confirm`, {
					headers,
					data: { verballyConfirmed: false }
				})
			).status()
		).toBe(422);
		expect(
			(
				await manager.post(`/api/staff/incidents/${id}/confirm`, {
					headers,
					data: { verballyConfirmed: true }
				})
			).status()
		).toBe(403);
		const claims = await Promise.all(
			[a, b].map((c) =>
				c.post(`/api/staff/incidents/${id}/confirm`, { headers, data: { verballyConfirmed: true } })
			)
		);
		expect(claims.map((r) => r.status()).sort()).toEqual([200, 409]);
		const winner = [a, b][claims[0].status() === 200 ? 0 : 1],
			loser = winner === a ? b : a;
		const detail = await (await winner.get(`/api/staff/incidents/${id}`)).json();
		expect(detail).toMatchObject({
			incident: { status: 'In progress' },
			medical: { allergies: privateMedical },
			personal: { latitude: 14.5995, longitude: 120.9842 }
		});
		expect(detail.emergencyContacts).toHaveLength(1);
		const ownerReports = await (
			await winner.get('/api/staff/incidents?view=reports&status=All')
		).json();
		expect(ownerReports.incidents.map((item) => item.id)).toContain(id);
		for (const reader of [winner, manager]) {
			const found = await (
				await reader.get(`/api/staff/incidents?view=reports&status=All&search=${reference}`)
			).json();
			expect(found).toMatchObject({ total: 1 });
			expect(found.incidents[0]).toMatchObject({ id, reference });
		}
		for (const view of ['alerts', 'reports']) {
			const hiddenList = await (
				await loser.get(`/api/staff/incidents?view=${view}&status=All&search=${id}`)
			).json();
			expect(hiddenList).toMatchObject({ incidents: [], total: 0 });
			const hiddenReference = await (
				await loser.get(`/api/staff/incidents?view=${view}&status=All&search=${reference}`)
			).json();
			expect(hiddenReference).toMatchObject({ incidents: [], total: 0 });
		}
		expect((await loser.get(`/api/staff/incidents/${id}`)).status()).toBe(404);
		expect((await loser.get(`/api/staff/reports/${id}`)).status()).toBe(404);
		for (const reader of [winner, manager]) {
			const response = await reader.get(`/api/staff/reports/${id}`);
			expect(response.status()).toBe(200);
			expect(response.headers()['cache-control']).toBe('no-store');
			expect(await response.text()).not.toContain(privateMedical);
			expect(await response.json()).toMatchObject({
				incident: { id, status: 'In progress' },
				latitude: 14.5995,
				longitude: 120.9842
			});
		}
		for (const reader of [loser, manager]) {
			if (reader === manager) {
				const hidden = await reader.get(`/api/staff/incidents/${id}`);
				expect(await hidden.text()).not.toContain(privateMedical);
				expect(await hidden.json()).toMatchObject({ personal: null, notes: '', events: [] });
			}
			expect(
				(
					await reader.patch(`/api/staff/incidents/${id}`, {
						headers,
						data: { status: 'On route' }
					})
				).status()
			).toBe(403);
			expect(
				(
					await reader.post(`/api/staff/incidents/${id}/notes`, {
						headers,
						data: { notes: 'Denied' }
					})
				).status()
			).toBe(403);
		}
		expect(
			(
				await winner.patch(`/api/staff/incidents/${id}`, { headers, data: { status: 'Resolved' } })
			).status()
		).toBe(409);
		expect(
			(
				await winner.post(`/api/staff/incidents/${id}/notes`, {
					headers,
					data: { notes: 'x'.repeat(2001) }
				})
			).status()
		).toBe(422);
		expect(
			(
				await winner.post(`/api/staff/incidents/${id}/notes`, {
					headers,
					data: { notes: 'Caller reports chest pain.' }
				})
			).status()
		).toBe(200);
		expect(
			(
				await winner.patch(`/api/staff/incidents/${id}`, { headers, data: { status: 'On route' } })
			).status()
		).toBe(200);
		const resolved = await winner.patch(`/api/staff/incidents/${id}`, {
			headers,
			data: { status: 'Resolved' }
		});
		expect(resolved.status()).toBe(200);
		const completed = await resolved.json();
		expect(Date.parse(completed.incident.endedAt)).toBeGreaterThanOrEqual(
			Date.parse(completed.incident.startedAt)
		);
		expect(completed.incident.confirmedAt).toBeTruthy();
		expect(completed.notes).toBe('Caller reports chest pain.');
		expect(await (await winner.get(`/api/staff/reports/${id}`)).json()).toMatchObject({
			incident: { status: 'Resolved', endedAt: completed.incident.endedAt },
			notes: 'Caller reports chest pain.'
		});
		expect((await loser.get(`/api/staff/reports/${id}`)).status()).toBe(404);
		expect(completed.events.map((e) => e.type).sort()).toEqual(
			['created', 'confirmed', 'note', 'on_route', 'resolved'].sort()
		);
		expect(
			(
				await winner.post(`/api/staff/incidents/${id}/notes`, {
					headers,
					data: { notes: 'Late edit' }
				})
			).status()
		).toBe(409);
		expect((await (await request.get('/api/incidents')).json()).incidents[0].status).toBe(
			'Resolved'
		);
		expect((await winner.get('/api/staff/incidents?page=0')).status()).toBe(422);
		expect((await winner.get('/api/staff/incidents?status=bad')).status()).toBe(422);
		expect((await winner.get('/api/staff/incidents?view=other-dispatchers')).status()).toBe(422);
		expect(
			(await (await winner.get('/api/staff/incidents?search=%25&status=All')).json()).total
		).toBe(0);
	} finally {
		for (const context of contexts) await context.dispose();
	}
});

test('failed audit writes roll back SOS creation and dispatcher assignment', async ({
	request,
	playwright
}) => {
	test.setTimeout(90000);
	const caller = await provision();
	await login(request, caller);
	const input = sos(caller.profileId);
	const db = database();
	const staff = await provision('dispatcher');
	const dispatcher = await playwright.request.newContext({ baseURL: origin });
	try {
		await login(dispatcher, staff);
		db.exec(
			"CREATE TRIGGER fail_incident_event BEFORE INSERT ON incident_event BEGIN SELECT RAISE(ABORT,'isolated audit rollback'); END"
		);
		try {
			expect((await request.post('/api/incidents', { headers, data: input })).status()).toBe(500);
			expect(
				db.prepare('SELECT count(*) AS n FROM incident WHERE caller_user_id=?').get(caller.id)
			).toMatchObject({ n: 0 });
		} finally {
			db.exec('DROP TRIGGER fail_incident_event');
		}
		const response = await request.post('/api/incidents', { headers, data: input });
		const id = (await response.json()).incident.id;
		db.exec(
			"CREATE TRIGGER fail_incident_event BEFORE INSERT ON incident_event BEGIN SELECT RAISE(ABORT,'isolated audit rollback'); END"
		);
		try {
			expect(
				(
					await dispatcher.post(`/api/staff/incidents/${id}/confirm`, {
						headers,
						data: { verballyConfirmed: true }
					})
				).status()
			).toBe(500);
			expect(
				db.prepare('SELECT status,dispatcher_user_id,confirmed_at FROM incident WHERE id=?').get(id)
			).toMatchObject({ status: 'Not assigned', dispatcher_user_id: null, confirmed_at: null });
		} finally {
			db.exec('DROP TRIGGER fail_incident_event');
		}
	} finally {
		db.close();
		await dispatcher.dispose();
	}
});
