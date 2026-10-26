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
import { challenge, invitation } from './trusted-fixture';

for (const [relationship, matching] of [
	['Parent', 'Child'],
	['Grandparent', 'Grandchild'],
	['Friend', 'Friend'],
	['Caregiver', 'Care recipient'],
	['Teacher', 'Student']
]) {
	test(`trusted relationships must match ${relationship} with ${matching} before mutual approval`, async ({
		request,
		playwright
	}) => {
		const owner = await provision();
		const scanner = await provision();
		await login(request, owner);
		const other = await playwright.request.newContext({ baseURL: origin });
		try {
			await login(other, scanner);
			const qr = await invitation(request, owner.id);
			const scan = await other.post('/api/trusted/scan', {
				headers,
				data: { token: qr.token, relationship }
			});
			expect(scan.status()).toBe(201);
			const { connection } = await scan.json();
			const path = `/api/trusted/${connection.id}`;
			const approval = { action: 'approve', invitationId: qr.invitationId, requestMutual: true };
			const mismatch = await request.patch(path, {
				headers,
				data: { ...approval, mutualRelationship: 'Relative' }
			});
			expect(mismatch.status()).toBe(422);
			expect((await mismatch.json()).message).toContain(`must be ${matching}`);
			const unchanged = (await (await request.get('/api/trusted')).json()).connections;
			expect(unchanged).toHaveLength(1);
			expect(unchanged[0].status).toBe('pending');
			const result = await request.patch(path, {
				headers,
				data: { ...approval, mutualRelationship: matching }
			});
			expect(result.status()).toBe(200);
			const { mutualRequest } = await result.json();
			expect(mutualRequest).toMatchObject({ relationship: matching, status: 'pending' });
			expect(
				(await request.post('/api/incidents', { headers, data: sos(scanner.profileId) })).status()
			).toBe(403);
			expect(
				(
					await other.patch(`/api/trusted/${mutualRequest.id}`, {
						headers,
						data: { action: 'approve', invitationId: mutualRequest.invitationId }
					})
				).status()
			).toBe(200);
		} finally {
			await other.dispose();
		}
	});
}

test('separate QR scans enforce matching relationships and legacy mismatches cannot be approved', async ({
	request,
	playwright
}) => {
	const owner = await provision();
	const scanner = await provision();
	await login(request, owner);
	const other = await playwright.request.newContext({ baseURL: origin });
	try {
		await login(other, scanner);
		const first = await invitation(request, owner.id);
		const scan = await other.post('/api/trusted/scan', {
			headers,
			data: { token: first.token, relationship: 'Parent' }
		});
		expect(scan.status()).toBe(201);
		const { connection } = await scan.json();
		const second = await invitation(other, scanner.id);
		const mismatch = await request.post('/api/trusted/scan', {
			headers,
			data: { token: second.token, relationship: 'Friend' }
		});
		expect(mismatch.status()).toBe(422);
		expect((await mismatch.json()).message).toContain('must be Child');
		const matching = await request.post('/api/trusted/scan', {
			headers,
			data: { token: second.token, relationship: 'Child' }
		});
		expect(matching.status()).toBe(201);
		const reverse = (await matching.json()).connection;
		const db = database();
		try {
			// Reproduce inconsistent records created before matching was enforced.
			db.prepare('UPDATE trusted_connection SET relationship=? WHERE id=?').run(
				'Friend',
				reverse.id
			);
		} finally {
			db.close();
		}
		const approval = await request.patch(`/api/trusted/${connection.id}`, {
			headers,
			data: { action: 'approve', invitationId: first.invitationId }
		});
		expect(approval.status()).toBe(409);
		expect((await approval.json()).message).toContain('relationships do not match');
		expect(
			(await (await request.get('/api/trusted')).json()).connections.every(
				(item: { status: string }) => item.status === 'pending'
			)
		).toBe(true);
	} finally {
		await other.dispose();
	}
});

test('QR endpoints enforce roles, CSRF, strict fields, mail failure invalidation, and issuance limits', async ({
	request,
	playwright
}) => {
	test.setTimeout(90000);
	expect((await request.get('/api/trusted')).status()).toBe(401);
	expect((await request.post('/api/trusted/qr/challenge', { headers, data: {} })).status()).toBe(
		401
	);
	const person = await provision();
	await login(request, person);
	expect(
		(
			await request.post('/api/trusted/qr/challenge', {
				headers: { Origin: 'https://attacker.example' },
				data: {}
			})
		).status()
	).toBe(403);
	expect(
		(
			await request.post('/api/trusted/qr/challenge', {
				headers,
				data: { email: 'other@example.com' }
			})
		).status()
	).toBe(422);
	expect(
		(
			await request.post('/api/trusted/scan', {
				headers,
				data: { token: 'x'.repeat(43), relationship: 'Sibling', status: 'approved' }
			})
		).status()
	).toBe(422);
	expect(
		(
			await request.post('/api/trusted/scan', {
				headers,
				data: { token: 'preview-profile', relationship: 'Sibling' }
			})
		).status()
	).toBe(422);
	const failed = await request.post('/api/trusted/qr/challenge', { headers, data: {} });
	expect(failed.status()).toBe(502);
	const db = database();
	try {
		const record = db
			.prepare(
				"SELECT consumed_at,code_hash FROM verification_request WHERE user_id=? AND purpose='qr_access'"
			)
			.get(person.id);
		expect(record.consumed_at).not.toBeNull();
		expect(record.code_hash).toMatch(/^[a-f0-9]{64}$/);
		expect(await failed.text()).not.toContain(record.code_hash);
	} finally {
		db.close();
	}
	expect((await request.post('/api/trusted/qr/challenge', { headers, data: {} })).status()).toBe(
		429
	);
	const limited = await provision();
	const other = await playwright.request.newContext({ baseURL: origin });
	try {
		await login(other, limited);
		for (let i = 0; i < 5; i++) challenge(limited.id);
		const db = database();
		try {
			db.prepare('UPDATE verification_request SET created_at=? WHERE user_id=?').run(
				Date.now() - 120000,
				limited.id
			);
		} finally {
			db.close();
		}
		expect((await other.post('/api/trusted/qr/challenge', { headers, data: {} })).status()).toBe(
			429
		);
		const staff = await provision('dispatcher');
		await login(other, staff, false);
		expect((await other.get('/api/trusted')).status()).toBe(403);
		expect(
			(
				await other.post('/api/trusted/scan', {
					headers,
					data: { token: 'x'.repeat(43), relationship: 'Sibling' }
				})
			).status()
		).toBe(403);
	} finally {
		await other.dispose();
	}
});

test('email codes are account/purpose bound, expire, lock after five guesses, and are consumed once', async ({
	request,
	playwright
}) => {
	test.setTimeout(90000);
	const owner = await provision(),
		stranger = await provision();
	await login(request, owner);
	const other = await playwright.request.newContext({ baseURL: origin });
	try {
		await login(other, stranger);
		const otp = challenge(owner.id);
		expect(
			(
				await other.post('/api/trusted/qr', {
					headers,
					data: { requestId: otp.requestId, code: otp.code }
				})
			).status()
		).toBe(422);
		const wrong = otp.code === '000000' ? '000001' : '000000';
		for (let i = 0; i < 5; i++)
			expect(
				(
					await request.post('/api/trusted/qr', {
						headers,
						data: { requestId: otp.requestId, code: wrong }
					})
				).status()
			).toBe(422);
		expect(
			(
				await request.post('/api/trusted/qr', {
					headers,
					data: { requestId: otp.requestId, code: otp.code }
				})
			).status()
		).toBe(422);
		const db = database();
		try {
			expect(
				db.prepare('SELECT attempts FROM verification_request WHERE id=?').get(otp.requestId)
			).toMatchObject({ attempts: 5 });
		} finally {
			db.close();
		}
		for (const options of [{ expired: true }, { purpose: 'email' }]) {
			const bad = challenge(owner.id, options);
			expect(
				(
					await request.post('/api/trusted/qr', {
						headers,
						data: { requestId: bad.requestId, code: bad.code }
					})
				).status()
			).toBe(422);
		}
		const fresh = challenge(owner.id);
		const replies = await Promise.all(
			[0, 1].map(() =>
				request.post('/api/trusted/qr', {
					headers,
					data: { requestId: fresh.requestId, code: fresh.code }
				})
			)
		);
		expect(replies.map((r) => r.status()).sort()).toEqual([201, 422]);
		const qr = await replies.find((r) => r.status() === 201)!.json();
		expect(qr.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
		const sql = database();
		try {
			const saved = sql
				.prepare('SELECT token_hash FROM qr_invitation WHERE id=?')
				.get(qr.invitationId);
			expect(saved.token_hash).toMatch(/^[a-f0-9]{64}$/);
			expect(saved.token_hash).not.toBe(qr.token);
		} finally {
			sql.close();
		}
	} finally {
		await other.dispose();
	}
});

test('expired, replaced, locked and self QR codes do not grant a connection', async ({
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
		const first = await invitation(request, owner.id);
		expect(
			(
				await request.post('/api/trusted/scan', {
					headers,
					data: { token: first.token, relationship: 'Self' }
				})
			).status()
		).toBe(409);
		expect(
			(await other.delete(`/api/trusted/qr/${first.invitationId}`, { headers, data: {} })).status()
		).toBe(404);
		const next = await invitation(request, owner.id);
		expect(
			(
				await other.post('/api/trusted/scan', {
					headers,
					data: { token: first.token, relationship: 'Sibling' }
				})
			).status()
		).toBe(409);
		expect(
			(await request.delete(`/api/trusted/qr/${next.invitationId}`, { headers, data: {} })).status()
		).toBe(200);
		expect(
			(
				await other.post('/api/trusted/scan', {
					headers,
					data: { token: next.token, relationship: 'Sibling' }
				})
			).status()
		).toBe(409);
		const expired = await invitation(request, owner.id);
		const db = database();
		try {
			db.prepare('UPDATE qr_invitation SET created_at=?,expires_at=? WHERE id=?').run(
				Date.now() - 600000,
				Date.now() - 1000,
				expired.invitationId
			);
		} finally {
			db.close();
		}
		expect(
			(
				await other.post('/api/trusted/scan', {
					headers,
					data: { token: expired.token, relationship: 'Sibling' }
				})
			).status()
		).toBe(422);
		expect((await (await other.get('/api/trusted')).json()).connections).toEqual([]);
	} finally {
		await other.dispose();
	}
});

test('single-use scan needs owner approval; permissions stay directional and revocation blocks SOS immediately', async ({
	request,
	playwright
}) => {
	test.setTimeout(120000);
	const owner = await provision(),
		first = await provision(),
		second = await provision();
	await login(request, owner);
	const contexts = await Promise.all(
		[first, second].map(() => playwright.request.newContext({ baseURL: origin }))
	);
	try {
		await login(contexts[0], first);
		await login(contexts[1], second);
		const qr = await invitation(request, owner.id);
		const responses = await Promise.all(
			contexts.map((c) =>
				c.post('/api/trusted/scan', { headers, data: { token: qr.token, relationship: 'Sibling' } })
			)
		);
		expect(responses.map((r) => r.status()).sort()).toEqual([201, 409]);
		const index = responses[0].status() === 201 ? 0 : 1;
		const winner = contexts[index],
			outsider = contexts[1 - index],
			actor = [first, second][index];
		const connection = (await responses[index].json()).connection;
		expect(connection.status).toBe('pending');
		expect(
			(
				await winner.post('/api/trusted/scan', {
					headers,
					data: { token: qr.token, relationship: 'Sibling' }
				})
			).status()
		).toBe(200);
		expect(
			(
				await winner.patch(`/api/trusted/${connection.id}`, {
					headers,
					data: { action: 'approve', invitationId: qr.invitationId }
				})
			).status()
		).toBe(403);
		expect(
			(
				await outsider.patch(`/api/trusted/${connection.id}`, {
					headers,
					data: { action: 'revoke' }
				})
			).status()
		).toBe(404);
		expect((await (await outsider.get('/api/trusted')).json()).connections).toEqual([]);
		expect(
			(await winner.post('/api/incidents', { headers, data: sos(owner.profileId) })).status()
		).toBe(403);
		expect(
			(
				await request.patch(`/api/trusted/${connection.id}`, {
					headers,
					data: { action: 'approve', invitationId: crypto.randomUUID() }
				})
			).status()
		).toBe(409);
		expect(
			(
				await request.patch(`/api/trusted/${connection.id}`, {
					headers,
					data: { action: 'approve', invitationId: qr.invitationId }
				})
			).status()
		).toBe(200);
		const listing = await winner.get('/api/trusted');
		expect(listing.headers()['cache-control']).toBe('no-store');
		expect(await listing.text()).not.toContain(privateMedical);
		expect(
			(await (await winner.get('/api/incidents/targets')).json()).targets.map((t) => t.id)
		).toContain(owner.profileId);
		expect(
			(await (await request.get('/api/incidents/targets')).json()).targets.map((t) => t.id)
		).not.toContain(actor.profileId);
		expect(
			(await winner.post('/api/incidents', { headers, data: sos(owner.profileId) })).status()
		).toBe(201);
		expect(
			(
				await request.patch(`/api/trusted/${connection.id}`, {
					headers,
					data: { action: 'revoke' }
				})
			).status()
		).toBe(200);
		expect(
			(await winner.post('/api/incidents', { headers, data: sos(owner.profileId) })).status()
		).toBe(403);
		expect(
			(await (await winner.get('/api/incidents/targets')).json()).targets.map((t) => t.id)
		).not.toContain(owner.profileId);
		const replacement = await invitation(request, owner.id);
		const pending = await winner.post('/api/trusted/scan', {
			headers,
			data: { token: replacement.token, relationship: 'Friend' }
		});
		expect(pending.status()).toBe(201);
		expect((await pending.json()).connection).toMatchObject({
			id: connection.id,
			status: 'pending'
		});
		expect(
			(
				await request.patch(`/api/trusted/${connection.id}`, {
					headers,
					data: { action: 'approve', invitationId: qr.invitationId }
				})
			).status()
		).toBe(409);
		expect(
			(await winner.post('/api/incidents', { headers, data: sos(owner.profileId) })).status()
		).toBe(403);
		expect(
			(
				await winner.patch(`/api/trusted/${connection.id}`, { headers, data: { action: 'revoke' } })
			).status()
		).toBe(200);
		const db = database();
		try {
			expect(
				db.prepare('SELECT status FROM trusted_connection WHERE id=?').get(connection.id)
			).toMatchObject({ status: 'revoked' });
			expect(
				db.prepare('SELECT count(*) AS n FROM incident WHERE caller_user_id=?').get(actor.id)
			).toMatchObject({ n: 1 });
		} finally {
			db.close();
		}
	} finally {
		for (const context of contexts) await context.dispose();
	}
});

test('racing approval and cancellation cannot revive a revoked grant', async ({
	request,
	playwright
}) => {
	test.setTimeout(90000);
	const owner = await provision(),
		person = await provision();
	await login(request, owner);
	const other = await playwright.request.newContext({ baseURL: origin });
	try {
		await login(other, person);
		const qr = await invitation(request, owner.id);
		const connection = (
			await (
				await other.post('/api/trusted/scan', {
					headers,
					data: { token: qr.token, relationship: 'Sibling' }
				})
			).json()
		).connection;
		const results = await Promise.all([
			request.patch(`/api/trusted/${connection.id}`, {
				headers,
				data: { action: 'approve', invitationId: qr.invitationId }
			}),
			other.patch(`/api/trusted/${connection.id}`, { headers, data: { action: 'revoke' } })
		]);
		expect(results[1].status()).toBe(200);
		expect([200, 409]).toContain(results[0].status());
		const db = database();
		try {
			expect(
				db.prepare('SELECT status FROM trusted_connection WHERE id=?').get(connection.id)
			).toMatchObject({ status: 'revoked' });
		} finally {
			db.close();
		}
	} finally {
		await other.dispose();
	}
});

test('transaction failures preserve OTP and QR usability without partial connections', async ({
	request,
	playwright
}) => {
	test.setTimeout(90000);
	const owner = await provision(),
		person = await provision();
	await login(request, owner);
	const other = await playwright.request.newContext({ baseURL: origin });
	const db = database();
	try {
		await login(other, person);
		const otp = challenge(owner.id);
		db.exec(
			"CREATE TRIGGER fail_qr BEFORE INSERT ON qr_invitation BEGIN SELECT RAISE(ABORT,'isolated QR rollback'); END"
		);
		try {
			expect(
				(
					await request.post('/api/trusted/qr', {
						headers,
						data: { requestId: otp.requestId, code: otp.code }
					})
				).status()
			).toBe(500);
			expect(
				db.prepare('SELECT consumed_at FROM verification_request WHERE id=?').get(otp.requestId)
			).toMatchObject({ consumed_at: null });
		} finally {
			db.exec('DROP TRIGGER fail_qr');
		}
		const unlocked = await request.post('/api/trusted/qr', {
			headers,
			data: { requestId: otp.requestId, code: otp.code }
		});
		expect(unlocked.status()).toBe(201);
		const qr = await unlocked.json();
		db.exec(
			"CREATE TRIGGER fail_trusted BEFORE INSERT ON trusted_connection BEGIN SELECT RAISE(ABORT,'isolated trust rollback'); END"
		);
		try {
			expect(
				(
					await other.post('/api/trusted/scan', {
						headers,
						data: { token: qr.token, relationship: 'Sibling' }
					})
				).status()
			).toBe(500);
			expect(
				db.prepare('SELECT consumed_at FROM qr_invitation WHERE id=?').get(qr.invitationId)
			).toMatchObject({ consumed_at: null });
		} finally {
			db.exec('DROP TRIGGER fail_trusted');
		}
		expect(
			(
				await other.post('/api/trusted/scan', {
					headers,
					data: { token: qr.token, relationship: 'Sibling' }
				})
			).status()
		).toBe(201);
	} finally {
		db.close();
		await other.dispose();
	}
});
