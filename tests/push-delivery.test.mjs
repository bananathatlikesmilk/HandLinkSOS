import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { deliverPushNotifications } from '../src/lib/server/push-delivery.ts';

test('push migration preserves legacy device data and adds no implicit subscription', () => {
	const client = new Database(':memory:');
	client.pragma('foreign_keys=ON');
	try {
		const migrations = readMigrationFiles({ migrationsFolder: './drizzle' });
		for (const migration of migrations.slice(0, 9))
			for (const statement of migration.sql) client.exec(statement);
		client.exec(
			"INSERT INTO user (id,name,email,updated_at) VALUES ('legacy','Legacy','legacy@example.com',1)"
		);
		client.exec(
			"INSERT INTO device (id,user_id,platform,push_token) VALUES ('legacy-device','legacy','android','legacy-token')"
		);
		const before = client.prepare('SELECT * FROM device').get();
		for (const statement of migrations[9].sql) client.exec(statement);
		const after = client.prepare('SELECT * FROM device').get();
		assert.deepEqual(
			Object.fromEntries(Object.keys(before).map((key) => [key, after[key]])),
			before
		);
		assert.equal(after.session_id, null);
		assert.equal(client.prepare('SELECT count(*) n FROM push_delivery').get().n, 0);
		assert.deepEqual(client.pragma('foreign_key_check'), []);
	} finally {
		client.close();
	}
});

function fixture() {
	const client = new Database(':memory:');
	client.pragma('foreign_keys=ON');
	const db = drizzle(client);
	migrate(db, { migrationsFolder: './drizzle' });
	const now = Date.now();
	for (const id of ['owner', 'viewer']) {
		client
			.prepare(
				"INSERT INTO user (id,name,email,email_verified,role,updated_at) VALUES (?,?,?,1,'user',?)"
			)
			.run(id, 'PRIVATE-NAME', `${id}@example.com`, now);
		client
			.prepare(
				"INSERT INTO user_profile (id,user_id,first_name,last_name,birthday,sex,phone,updated_at) VALUES (?,?,'PRIVATE','PERSON','2000-01-01','Female','+639171234567',?)"
			)
			.run(`p-${id}`, id, now);
		client
			.prepare('INSERT INTO session (id,user_id,token,expires_at,updated_at) VALUES (?,?,?,?,?)')
			.run(`s-${id}`, id, `secret-${id}`, now + 3600000, now);
		client
			.prepare(
				"INSERT INTO device (id,user_id,platform,push_token,session_id,created_at) VALUES (?,?,'android',?,?,?)"
			)
			.run(`d-${id}`, id, `fake-${id}-token-123456789`, `s-${id}`, now - 1000);
	}
	client
		.prepare(
			"INSERT INTO incident (id,person_profile_id,caller_user_id,caller_name,latitude,longitude,idempotency_key) VALUES ('incident','p-owner','viewer','PRIVATE-CALLER',14,121,'key')"
		)
		.run();
	const notice = (type = 'sos', id = crypto.randomUUID(), person = 'owner') => {
		client
			.prepare(
				'INSERT INTO notification (id,user_id,type,incident_id,location_session_id,delivery_key,created_at) VALUES (?,?,?,?,?,?,?)'
			)
			.run(
				id,
				person,
				type,
				type === 'sos' ? 'incident' : null,
				type === 'sos' ? null : 'share',
				id,
				now
			);
		return id;
	};
	return { client, db, now, notice };
}

test('push sends generic text once per device and concurrent sweeps do not duplicate sends', async () => {
	const f = fixture();
	try {
		f.notice();
		const messages = [];
		const send = async (message) => {
			messages.push(message);
			await new Promise((r) => setTimeout(r, 10));
			return 'accepted';
		};
		await Promise.all([
			deliverPushNotifications(f.db, send, new Date(f.now)),
			deliverPushNotifications(f.db, send, new Date(f.now))
		]);
		await deliverPushNotifications(f.db, send, new Date(f.now + 1000));
		assert.equal(messages.length, 1);
		const m = messages[0];
		assert.equal(m.android.notification.visibility, 'private');
		assert.deepEqual(m.data, { screen: 'notifications' });
		for (const secret of ['PRIVATE', '639171234567', '14.5995', 'secret-owner', 'incident'])
			assert.ok(!JSON.stringify(m).includes(secret));
		assert.equal(f.client.prepare('SELECT state FROM push_delivery').get().state, 'sent');
	} finally {
		f.client.close();
	}
});

test('revoked, expired, signed-out, banned and deactivated accounts cannot receive push', async () => {
	for (const mutation of [
		"UPDATE device SET revoked_at=1 WHERE user_id='owner'",
		"UPDATE session SET expires_at=1 WHERE user_id='owner'",
		"DELETE FROM session WHERE user_id='owner'",
		"UPDATE user SET banned=1 WHERE id='owner'",
		"UPDATE user_profile SET deactivated_at=1 WHERE user_id='owner'",
		"UPDATE device SET user_id='viewer' WHERE user_id='owner'"
	]) {
		const f = fixture();
		try {
			f.notice();
			f.client.exec(mutation);
			let calls = 0;
			await deliverPushNotifications(
				f.db,
				async () => {
					calls++;
					return 'x';
				},
				new Date(f.now)
			);
			assert.equal(calls, 0, mutation);
			assert.deepEqual(f.client.pragma('foreign_key_check'), []);
		} finally {
			f.client.close();
		}
	}
});

test('read alerts, stale alerts and notifications predating a new account binding are skipped', async () => {
	for (const mutation of [
		'UPDATE notification SET read_at=1',
		'UPDATE notification SET created_at=created_at-1000000',
		'UPDATE device SET created_at=created_at+5000'
	]) {
		const f = fixture();
		try {
			f.notice();
			f.client.exec(mutation);
			let calls = 0;
			await deliverPushNotifications(
				f.db,
				async () => {
					calls++;
					return 'x';
				},
				new Date(f.now)
			);
			assert.equal(calls, 0);
		} finally {
			f.client.close();
		}
	}
});

test('failed delivery retries with backoff; invalid FCM tokens are revoked', async () => {
	const f = fixture();
	try {
		f.notice();
		let calls = 0;
		const fail = async () => {
			calls++;
			throw Object.assign(new Error('fixture failure'), { code: 'messaging/server-unavailable' });
		};
		await deliverPushNotifications(f.db, fail, new Date(f.now));
		await deliverPushNotifications(f.db, fail, new Date(f.now + 1000));
		assert.equal(calls, 1);
		await deliverPushNotifications(
			f.db,
			async () => {
				calls++;
				throw Object.assign(new Error('invalid'), {
					code: 'messaging/registration-token-not-registered'
				});
			},
			new Date(f.now + 61000)
		);
		assert.equal(calls, 2);
		assert.equal(f.client.prepare('SELECT state FROM push_delivery').get().state, 'failed');
		assert.ok(
			f.client.prepare("SELECT revoked_at FROM device WHERE id='d-owner'").get().revoked_at
		);
	} finally {
		f.client.close();
	}
});

test('final-minute trusted alerts require current sharing access and expire at the session deadline', async () => {
	const f = fixture();
	try {
		f.client
			.prepare(
				"INSERT INTO location_session (id,owner_profile_id,created_at,expires_at) VALUES ('share','p-owner',?,?)"
			)
			.run(f.now - 60000, f.now + 30000);
		f.client
			.prepare(
				"INSERT INTO trusted_connection (id,owner_profile_id,requester_profile_id,relationship,status,approved_at) VALUES ('trust','p-owner','p-viewer','Sibling','approved',?)"
			)
			.run(f.now);
		f.client.exec(
			"INSERT INTO location_recipient (id,session_id,user_id) VALUES ('recipient','share','viewer')"
		);
		f.notice('location_expiring', 'warning', 'viewer');
		const messages = [];
		await deliverPushNotifications(
			f.db,
			async (m) => {
				messages.push(m);
				return 'x';
			},
			new Date(f.now)
		);
		assert.equal(messages.length, 1);
		assert.equal(messages[0].android.ttl, 30000);
		f.client.exec("UPDATE trusted_connection SET revoked_at=1 WHERE id='trust'");
		f.notice('location_expiring', 'revoked', 'viewer');
		await deliverPushNotifications(
			f.db,
			async (m) => {
				messages.push(m);
				return 'x';
			},
			new Date(f.now)
		);
		assert.equal(messages.length, 1);
		f.notice('location_expiring', 'late', 'owner');
		await deliverPushNotifications(
			f.db,
			async (m) => {
				messages.push(m);
				return 'x';
			},
			new Date(f.now + 31000)
		);
		assert.equal(messages.length, 1);
	} finally {
		f.client.close();
	}
});
