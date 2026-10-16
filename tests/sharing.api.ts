import { expect, test } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { database, headers, login, origin, privateMedical, provision } from './incident-fixture';
import { approveSharingTrust, expireSharing, sharingInput } from './sharing-fixture';

test('one-minute warning reaches owner and selected trusted profiles, survives pagination, and clears on read, stop and expiry', async ({
	request,
	playwright
}) => {
	test.setTimeout(90000);
	const owner = await provision(),
		viewer = await provision(),
		stranger = await provision();
	approveSharingTrust(owner.profileId, viewer.profileId);
	approveSharingTrust(owner.profileId, stranger.profileId);
	await login(request, owner);
	const receiving = await playwright.request.newContext({ baseURL: origin });
	const other = await playwright.request.newContext({ baseURL: origin });
	try {
		await login(receiving, viewer);
		await login(other, stranger);
		const response = await request.post('/api/sharing', { headers, data: sharingInput(viewer.id) });
		expect(response.status(), await response.text()).toBe(200);
		const id = (await response.json()).session.id;
		expect(
			(await (await request.get('/api/notifications')).json()).activeLocationWarning
		).toBeNull();
		const db = database();
		try {
			const now = Date.now();
			db.prepare('UPDATE location_session SET created_at=?,expires_at=? WHERE id=?').run(
				now - 60000,
				now + 55000,
				id
			);
		} finally {
			db.close();
		}
		const results = await Promise.all(
			Array.from({ length: 3 }, () => request.get('/api/notifications'))
		);
		for (const result of results) expect(result.status()).toBe(200);
		const notice = (await results[0].json()).notifications.find(
			(n) => n.type === 'location_expiring'
		);
		expect(notice).toMatchObject({ sessionId: id, isOwner: true, sessionStatus: 'active' });
		expect(notice.expiresAt).toBeTruthy();
		const check = database();
		try {
			expect(
				check
					.prepare(
						"SELECT count(*) n FROM notification WHERE type='location_expiring' AND location_session_id=?"
					)
					.get(id)
			).toEqual({ n: 2 });
			const insert = check.prepare(
				"INSERT INTO notification (id,user_id,location_session_id,type,delivery_key,created_at) VALUES (?,?,?,'location_shared',?,?)"
			);
			for (let i = 0; i < 25; i++)
				insert.run(crypto.randomUUID(), owner.id, id, crypto.randomUUID(), Date.now() + i);
		} finally {
			check.close();
		}
		const paged = await (await request.get('/api/notifications')).json();
		expect(paged.notifications.some((n) => n.id === notice.id)).toBe(false);
		expect(paged.activeLocationWarning).toMatchObject({ id: notice.id, sessionId: id });
		for (const context of [receiving, other]) {
			const state = await (await context.get('/api/notifications')).json();
			if (context === receiving) {
				expect(state.activeLocationWarning).toMatchObject({
					sessionId: id,
					isOwner: false,
					ownerName: 'Casey Reyes'
				});
				expect(state.notifications.find((n) => n.type === 'location_expiring')).toMatchObject({
					sessionId: id,
					isOwner: false,
					sessionStatus: 'active'
				});
			} else {
				expect(state.activeLocationWarning).toBeNull();
				expect(state.notifications.some((n) => n.type === 'location_expiring')).toBe(false);
			}
			expect(
				(await context.post(`/api/notifications/${notice.id}/read`, { headers, data: {} })).status()
			).toBe(404);
		}
		expect(
			(await request.post(`/api/notifications/${notice.id}/read`, { headers, data: {} })).status()
		).toBe(200);
		expect(
			(await (await request.get('/api/notifications')).json()).activeLocationWarning
		).toBeNull();
		expect(
			(await (await receiving.get('/api/notifications')).json()).activeLocationWarning
		).not.toBeNull();
		const unread = database();
		try {
			unread.prepare('UPDATE notification SET read_at=NULL WHERE id=?').run(notice.id);
		} finally {
			unread.close();
		}
		expect((await request.post(`/api/sharing/${id}/stop`, { headers, data: {} })).status()).toBe(
			200
		);
		expect(
			(await (await request.get('/api/notifications')).json()).activeLocationWarning
		).toBeNull();
		expect(
			(await (await receiving.get('/api/notifications')).json()).activeLocationWarning
		).toBeNull();
		const next = (
			await (await request.post('/api/sharing', { headers, data: sharingInput(viewer.id) })).json()
		).session.id;
		expireSharing(next);
		const expired = await (await request.get('/api/notifications')).json();
		expect(expired.activeLocationWarning).toBeNull();
		expect(
			expired.notifications.some((n) => n.type === 'location_expiring' && n.sessionId === next)
		).toBe(false);
	} finally {
		await receiving.dispose();
		await other.dispose();
	}
});

test('sharing rejects anonymous, staff, unsafe origin, arbitrary recipients and invalid GPS input', async ({
	request,
	playwright
}) => {
	test.setTimeout(90000);
	expect((await request.get('/api/sharing')).status()).toBe(401);
	const owner = await provision(),
		viewer = await provision();
	await login(request, owner);
	const input = sharingInput(viewer.id);
	expect((await request.post('/api/sharing', { headers, data: input })).status()).toBe(403);
	approveSharingTrust(owner.profileId, viewer.profileId);
	for (const bad of [
		{ ...input, recipientUserIds: [owner.id] },
		{ ...input, recipientUserIds: [] },
		{ ...input, recipientUserIds: [viewer.id, viewer.id] },
		{ ...input, durationMinutes: 0 },
		{ ...input, durationMinutes: 241 },
		{ ...input, ownerProfileId: owner.profileId },
		{ ...input, point: { ...input.point, latitude: 91 } },
		{ ...input, point: { ...input.point, accuracy: -1 } },
		{ ...input, point: { ...input.point, recordedAt: new Date(Date.now() - 600000).toISOString() } }
	]) {
		const response = await request.post('/api/sharing', { headers, data: bad });
		expect([403, 422]).toContain(response.status());
	}
	expect(
		(
			await request.post('/api/sharing', {
				headers: { Origin: 'https://attacker.example' },
				data: input
			})
		).status()
	).toBe(403);
	const staff = await playwright.request.newContext({ baseURL: origin });
	try {
		await login(staff, await provision('admin'));
		expect((await staff.get('/api/sharing')).status()).toBe(403);
		expect((await staff.post('/api/sharing', { headers, data: input })).status()).toBe(403);
	} finally {
		await staff.dispose();
	}
	expect((await (await request.get('/api/sharing')).json()).own).toBeNull();
});

test('only selected viewers read position; only owner updates or stops; stop removes all map access', async ({
	request,
	playwright
}) => {
	test.setTimeout(90000);
	const owner = await provision(),
		viewer = await provision(),
		unselected = await provision();
	approveSharingTrust(owner.profileId, viewer.profileId);
	approveSharingTrust(owner.profileId, unselected.profileId);
	await login(request, owner);
	const receiving = await playwright.request.newContext({ baseURL: origin }),
		other = await playwright.request.newContext({ baseURL: origin });
	try {
		await login(receiving, viewer);
		await login(other, unselected);
		const input = sharingInput(viewer.id);
		const responses = await Promise.all([
			request.post('/api/sharing', { headers, data: input }),
			request.post('/api/sharing', { headers, data: input })
		]);
		for (const r of responses) expect(r.status(), await r.text()).toBe(200);
		const id = (await responses[0].json()).session.id;
		expect(
			(await request.post('/api/sharing', { headers, data: sharingInput(viewer.id) })).status()
		).toBe(409);
		expect(
			(
				await request.post('/api/sharing', { headers, data: { ...input, durationMinutes: 16 } })
			).status()
		).toBe(409);
		const received = await (await receiving.get(`/api/sharing/${id}`)).json();
		expect(received.session).toMatchObject({
			status: 'active',
			isOwner: false,
			recipients: [],
			point: { latitude: input.point.latitude }
		});
		expect(JSON.stringify(received)).not.toContain(privateMedical);
		expect((await other.get(`/api/sharing/${id}`)).status()).toBe(404);
		expect((await (await receiving.get('/api/sharing')).json()).incoming).toHaveLength(1);
		expect((await (await other.get('/api/sharing')).json()).incoming).toEqual([]);
		expect(
			(await receiving.post(`/api/sharing/${id}/points`, { headers, data: input.point })).status()
		).toBe(404);
		expect((await receiving.post(`/api/sharing/${id}/stop`, { headers, data: {} })).status()).toBe(
			404
		);
		expect(
			(await request.post(`/api/sharing/${id}/points`, { headers, data: input.point })).status()
		).toBe(429);
		const db = database();
		try {
			db.prepare('UPDATE location_point SET recorded_at=? WHERE session_id=?').run(
				Date.now() - 301000,
				id
			);
		} finally {
			db.close();
		}
		const moved = { ...input.point, latitude: 14.61, recordedAt: new Date().toISOString() };
		expect(
			(await request.post(`/api/sharing/${id}/points`, { headers, data: moved })).status()
		).toBe(200);
		expect((await (await receiving.get(`/api/sharing/${id}`)).json()).session.point.latitude).toBe(
			14.61
		);
		const check = database();
		try {
			expect(
				check.prepare('SELECT count(*) n FROM location_point WHERE session_id=?').get(id)
			).toEqual({ n: 1 });
		} finally {
			check.close();
		}
		const notices = await (await receiving.get('/api/notifications')).json();
		expect(notices.notifications.filter((n) => n.sessionId === id)).toHaveLength(1);
		expect(notices.notifications.find((n) => n.sessionId === id)).toMatchObject({
			type: 'location_shared',
			sessionStatus: 'active'
		});
		expect(JSON.stringify(notices)).not.toContain('latitude');
		expect((await request.post(`/api/sharing/${id}/stop`, { headers, data: {} })).status()).toBe(
			200
		);
		expect((await request.post(`/api/sharing/${id}/stop`, { headers, data: {} })).status()).toBe(
			200
		);
		expect((await receiving.get(`/api/sharing/${id}`)).status()).toBe(410);
		expect((await (await request.get(`/api/sharing/${id}`)).json()).session.point).toBeNull();
		expect(
			(await request.post(`/api/sharing/${id}/points`, { headers, data: moved })).status()
		).toBe(409);
	} finally {
		await receiving.dispose();
		await other.dispose();
	}
});

test('trust revocation removes current location access and reapproval cannot revive old grants', async ({
	request,
	playwright
}) => {
	test.setTimeout(90000);
	const owner = await provision(),
		viewer = await provision();
	const connection = approveSharingTrust(owner.profileId, viewer.profileId);
	await login(request, owner);
	const receiving = await playwright.request.newContext({ baseURL: origin });
	try {
		await login(receiving, viewer);
		const id = (
			await (await request.post('/api/sharing', { headers, data: sharingInput(viewer.id) })).json()
		).session.id;
		expect(
			(
				await request.patch(`/api/trusted/${connection}`, { headers, data: { action: 'revoke' } })
			).status()
		).toBe(200);
		expect((await receiving.get(`/api/sharing/${id}`)).status()).toBe(404);
		const db = database();
		try {
			expect(
				db.prepare('SELECT revoked_at FROM location_recipient WHERE session_id=?').get(id)
					.revoked_at
			).toBeTruthy();
			db.prepare(
				"UPDATE trusted_connection SET status='approved',revoked_at=NULL,approved_at=? WHERE id=?"
			).run(Date.now(), connection);
		} finally {
			db.close();
		}
		expect((await receiving.get(`/api/sharing/${id}`)).status()).toBe(404);
		expireSharing(id);
		await receiving.get('/api/notifications');
		const db2 = database();
		try {
			expect(
				db2
					.prepare(
						"SELECT count(*) n FROM notification WHERE location_session_id=? AND user_id=? AND type='location_expired'"
					)
					.get(id, viewer.id)
			).toEqual({ n: 0 });
		} finally {
			db2.close();
		}
	} finally {
		await receiving.dispose();
	}
});

test('expired timer creates one notice per owner and selected viewer even without a browser worker', async ({
	request,
	playwright
}) => {
	test.setTimeout(90000);
	const owner = await provision(),
		viewer = await provision();
	approveSharingTrust(owner.profileId, viewer.profileId);
	await login(request, owner);
	const receiving = await playwright.request.newContext({ baseURL: origin });
	try {
		await login(receiving, viewer);
		const id = (
			await (
				await request.post('/api/sharing', { headers, data: sharingInput(viewer.id, 1) })
			).json()
		).session.id;
		expireSharing(id);
		for (let run = 0; run < 2; run++) {
			const result = spawnSync(process.execPath, ['scripts/expire-locations.mjs'], {
				env: { ...process.env, DATABASE_URL: process.env.HANDLINK_TEST_DB },
				encoding: 'utf8'
			});
			expect(result.status, result.stderr).toBe(0);
		}
		expect((await receiving.get(`/api/sharing/${id}`)).status()).toBe(410);
		const notice = (await (await receiving.get('/api/notifications')).json()).notifications.find(
			(n) => n.type === 'location_expired' && n.sessionId === id
		);
		expect(notice).toMatchObject({ sessionStatus: 'expired', isOwner: false });
		expect(
			(await receiving.post(`/api/notifications/${notice.id}/read`, { headers, data: {} })).status()
		).toBe(200);
		expect(
			(await request.post(`/api/notifications/${notice.id}/read`, { headers, data: {} })).status()
		).toBe(404);
		expect(
			(await (await request.get('/api/notifications')).json()).notifications.find(
				(n) => n.type === 'location_expired' && n.sessionId === id
			)
		).toMatchObject({ isOwner: true });
		const db = database();
		try {
			expect(
				db
					.prepare(
						"SELECT count(*) n FROM notification WHERE location_session_id=? AND type='location_expired'"
					)
					.get(id)
			).toEqual({ n: 2 });
			expect(
				db.prepare('SELECT expiry_notified_at FROM location_session WHERE id=?').get(id)
					.expiry_notified_at
			).toBeTruthy();
		} finally {
			db.close();
		}
	} finally {
		await receiving.dispose();
	}
});

test('failed notification writes roll back sharing start and expiry marking', async ({
	request
}) => {
	test.setTimeout(90000);
	const owner = await provision(),
		viewer = await provision();
	approveSharingTrust(owner.profileId, viewer.profileId);
	await login(request, owner);
	const db = database();
	const input = sharingInput(viewer.id, 1);
	try {
		db.exec(
			`CREATE TRIGGER fail_share_start BEFORE INSERT ON notification WHEN NEW.location_session_id='${input.id}' BEGIN SELECT RAISE(ABORT,'isolated sharing rollback'); END;`
		);
		expect((await request.post('/api/sharing', { headers, data: input })).status()).toBe(500);
		for (const table of ['location_session', 'location_recipient', 'location_point'])
			expect(
				db
					.prepare(
						`SELECT count(*) n FROM ${table} WHERE ${table === 'location_session' ? 'id' : 'session_id'}=?`
					)
					.get(input.id)
			).toEqual({ n: 0 });
		db.exec('DROP TRIGGER fail_share_start');
		expect((await request.post('/api/sharing', { headers, data: input })).status()).toBe(200);
		expireSharing(input.id);
		db.exec(
			`CREATE TRIGGER fail_share_expiry BEFORE INSERT ON notification WHEN NEW.location_session_id='${input.id}' AND NEW.type='location_expired' BEGIN SELECT RAISE(ABORT,'isolated expiry rollback'); END;`
		);
		expect((await request.get('/api/sharing')).status()).toBe(500);
		expect(
			db.prepare('SELECT expiry_notified_at FROM location_session WHERE id=?').get(input.id)
		).toEqual({ expiry_notified_at: null });
		expect(
			db
				.prepare(
					"SELECT count(*) n FROM notification WHERE location_session_id=? AND type='location_expired'"
				)
				.get(input.id)
		).toEqual({ n: 0 });
		db.exec('DROP TRIGGER fail_share_expiry');
		expect((await request.get('/api/sharing')).status()).toBe(200);
		expect(
			db
				.prepare(
					"SELECT count(*) n FROM notification WHERE location_session_id=? AND type='location_expired'"
				)
				.get(input.id)
		).toEqual({ n: 2 });
	} finally {
		db.exec('DROP TRIGGER IF EXISTS fail_share_start; DROP TRIGGER IF EXISTS fail_share_expiry;');
		db.close();
	}
});

test('unlinked emergency email cannot grant access; editing linked contact removes the old grant', async ({
	request,
	playwright
}) => {
	test.setTimeout(90000);
	const owner = await provision(),
		viewer = await provision();
	await login(request, owner);
	const receiving = await playwright.request.newContext({ baseURL: origin });
	const db = database();
	try {
		await login(receiving, viewer);
		db.prepare('UPDATE emergency_contact SET email=? WHERE profile_id=?').run(
			viewer.email,
			owner.profileId
		);
		expect((await (await request.get('/api/sharing')).json()).recipients).toEqual([]);
		db.prepare('UPDATE emergency_contact SET linked_user_id=? WHERE profile_id=?').run(
			viewer.id,
			owner.profileId
		);
		expect((await (await request.get('/api/sharing')).json()).recipients[0]).toMatchObject({
			userId: viewer.id,
			kind: 'emergency_contact'
		});
		const id = (
			await (await request.post('/api/sharing', { headers, data: sharingInput(viewer.id) })).json()
		).session.id;
		expect((await receiving.get(`/api/sharing/${id}`)).status()).toBe(200);
		const payload = {
			firstName: 'Casey',
			lastName: 'Reyes',
			birthday: '2000-01-01',
			sex: 'Female',
			phone: '+639171234567',
			medical: {
				bloodType: null,
				chronicCondition: '',
				allergies: '',
				currentMedications: '',
				additionalInformation: ''
			},
			emergencyContacts: [
				{
					firstName: 'New',
					lastName: 'Contact',
					phone: '+639181234567',
					email: 'new@example.com',
					relationship: 'Sibling'
				}
			]
		};
		expect((await request.put('/api/profile', { headers, data: payload })).status()).toBe(200);
		expect((await receiving.get(`/api/sharing/${id}`)).status()).toBe(404);
	} finally {
		db.close();
		await receiving.dispose();
	}
});

test('deactivation revokes recipient grants permanently and ends the owner session', async ({
	request,
	playwright
}) => {
	test.setTimeout(90000);
	const owner = await provision(),
		viewer = await provision();
	approveSharingTrust(owner.profileId, viewer.profileId);
	await login(request, owner);
	const receiving = await playwright.request.newContext({ baseURL: origin }),
		admin = await playwright.request.newContext({ baseURL: origin });
	try {
		await login(receiving, viewer);
		await login(admin, await provision('admin'));
		const id = (
			await (await request.post('/api/sharing', { headers, data: sharingInput(viewer.id) })).json()
		).session.id;
		expect(
			(
				await admin.patch(`/api/admin/accounts/${viewer.id}`, { headers, data: { active: false } })
			).status()
		).toBe(200);
		expect((await receiving.get(`/api/sharing/${id}`)).ok()).toBe(false);
		expect(
			(
				await admin.patch(`/api/admin/accounts/${viewer.id}`, { headers, data: { active: true } })
			).status()
		).toBe(200);
		await login(receiving, viewer);
		expect((await receiving.get(`/api/sharing/${id}`)).status()).toBe(404);
		expect((await request.post('/api/account/deactivate', { headers, data: {} })).status()).toBe(
			200
		);
		expect(
			(
				await admin.patch(`/api/admin/accounts/${owner.id}`, { headers, data: { active: true } })
			).status()
		).toBe(200);
		await login(request, owner);
		expect((await (await request.get(`/api/sharing/${id}`)).json()).session).toMatchObject({
			status: 'cancelled',
			point: null
		});
	} finally {
		await receiving.dispose();
		await admin.dispose();
	}
});
