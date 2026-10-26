import assert from 'node:assert/strict';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { eq } from 'drizzle-orm';
import { expireLocationSessions } from '../src/lib/server/location-expiry.ts';
import { profile, medicalProfile, user } from '../src/lib/server/db/schema.ts';
import {
	profileInput,
	incidentInput,
	confirmationInput,
	locationSessionInput,
	otpInput,
	locationPointInput
} from '../src/lib/server/validation.ts';

function database() {
	const client = new Database(':memory:');
	client.pragma('foreign_keys = ON');
	const db = drizzle(client);
	migrate(db, { migrationsFolder: './drizzle' });
	return { client, db };
}
function seed(client) {
	for (const id of ['owner', 'requester', 'dispatcher'])
		client
			.prepare('INSERT INTO user (id,name,email,updated_at) VALUES (?,?,?,?)')
			.run(id, id, `${id}@example.com`, Date.now());
	for (const [id, owner] of [
		['profile-owner', 'owner'],
		['profile-requester', 'requester']
	])
		client
			.prepare(
				'INSERT INTO user_profile (id,user_id,first_name,last_name,birthday,sex,phone,updated_at) VALUES (?,?,?,?,?,?,?,?)'
			)
			.run(id, owner, 'First', 'Last', '2000-01-01', 'Female', '+639171234567', Date.now());
}

test('beneficiary location migration preserves incidents and rejects invalid snapshots', () => {
	const client = new Database(':memory:');
	client.pragma('foreign_keys=ON');
	try {
		const migrations = readMigrationFiles({ migrationsFolder: './drizzle' });
		for (const migration of migrations.slice(0, 14))
			for (const statement of migration.sql) client.exec(statement);
		seed(client);
		client
			.prepare(
				"INSERT INTO incident (id,person_profile_id,caller_user_id,caller_name,latitude,longitude,idempotency_key) VALUES ('existing','profile-owner','owner','Owner',14,121,'retry')"
			)
			.run();
		const before = client.prepare('SELECT * FROM incident').get();
		for (const statement of migrations[14].sql) client.exec(statement);
		assert.deepEqual(client.prepare('SELECT * FROM incident').get(), before);
		assert.equal(client.prepare('SELECT count(*) AS n FROM incident_person_location').get().n, 0);
		const insert = client.prepare(
			'INSERT INTO incident_person_location (incident_id,latitude,longitude,accuracy,recorded_at) VALUES (?,?,?,?,?)'
		);
		assert.throws(() => insert.run('existing', 91, 121, 10, 1000));
		assert.throws(() => insert.run('existing', 14, 181, 10, 1000));
		assert.throws(() => insert.run('existing', 14, 121, -1, 1000));
		assert.throws(() => insert.run('missing', 14, 121, 10, 1000));
		insert.run('existing', 14, 121, 10, 1000);
		assert.throws(() => insert.run('existing', 14, 121, 10, 1000));
		assert.deepEqual(client.pragma('foreign_key_check'), []);
	} finally {
		client.close();
	}
});

test('SOS favorites migration preserves trusted connections and defaults existing rows to unfavorited', () => {
	const client = new Database(':memory:');
	client.pragma('foreign_keys=ON');
	try {
		const migrations = readMigrationFiles({ migrationsFolder: './drizzle' });
		for (const migration of migrations.slice(0, 13))
			for (const statement of migration.sql) client.exec(statement);
		seed(client);
		client
			.prepare(
				"INSERT INTO trusted_connection (id,owner_profile_id,requester_profile_id,relationship,status,approved_at) VALUES ('connection','profile-owner','profile-requester','Sibling','approved',?)"
			)
			.run(Date.now());
		const before = client.prepare('SELECT * FROM trusted_connection').get();
		for (const statement of migrations[13].sql) client.exec(statement);
		assert.deepEqual(client.prepare('SELECT * FROM trusted_connection').get(), {
			...before,
			requester_favorite: 0
		});
		client.prepare('UPDATE trusted_connection SET requester_favorite=1').run();
		assert.equal(
			client.prepare('SELECT requester_favorite FROM trusted_connection').get().requester_favorite,
			1
		);
		assert.throws(() => client.prepare('UPDATE trusted_connection SET requester_favorite=2').run());
		assert.deepEqual(client.pragma('foreign_key_check'), []);
	} finally {
		client.close();
	}
});

test('short incident references preserve old records, backfill in order, and remain unique and immutable', () => {
	const client = new Database(':memory:');
	client.pragma('foreign_keys=ON');
	try {
		const migrations = readMigrationFiles({ migrationsFolder: './drizzle' });
		for (const migration of migrations.slice(0, 8))
			for (const statement of migration.sql) client.exec(statement);
		seed(client);
		const insert = client.prepare(
			"INSERT INTO incident (id,person_profile_id,caller_user_id,caller_name,latitude,longitude,idempotency_key,created_at) VALUES (?,'profile-owner','owner','Owner',14,121,?,?)"
		);
		insert.run('newer', 'retry-newer', 2000);
		insert.run('older', 'retry-older', 1000);
		const before = client.prepare('SELECT * FROM incident ORDER BY id').all();
		client.transaction(() => {
			for (const statement of migrations[8].sql) client.exec(statement);
		})();
		assert.deepEqual(client.prepare('SELECT * FROM incident ORDER BY id').all(), before);
		const refs = () =>
			client
				.prepare(
					"SELECT incident_id,'HL-'||printf('%07d',number) AS reference FROM incident_reference ORDER BY number"
				)
				.all();
		assert.deepEqual(refs(), [
			{ incident_id: 'older', reference: 'HL-0000001' },
			{ incident_id: 'newer', reference: 'HL-0000002' }
		]);
		insert.run('next', 'retry-next', 3000);
		assert.deepEqual(refs().at(-1), { incident_id: 'next', reference: 'HL-0000003' });
		assert.throws(() =>
			client.prepare('UPDATE incident_reference SET number=100 WHERE number=1').run()
		);
		assert.throws(() =>
			client.prepare("UPDATE incident_reference SET incident_id='next' WHERE number=1").run()
		);
		assert.throws(() => client.prepare('DELETE FROM incident_reference WHERE number=3').run());
		assert.throws(() =>
			client.prepare("INSERT INTO incident_reference (incident_id) VALUES ('older')").run()
		);
		assert.throws(() =>
			client.prepare("INSERT INTO incident_reference (incident_id) VALUES ('missing')").run()
		);
		assert.throws(() =>
			client.transaction(() => {
				insert.run('rolled-back', 'retry-rollback', 4000);
				throw new Error('Isolated rollback');
			})()
		);
		assert.equal(
			client
				.prepare("SELECT count(*) n FROM incident_reference WHERE incident_id='rolled-back'")
				.get().n,
			0
		);
		assert.equal(refs().length, 3);
		assert.equal(client.pragma('integrity_check', { simple: true }), 'ok');
		assert.deepEqual(client.pragma('foreign_key_check'), []);
	} finally {
		client.close();
	}
});

test('location warning migration preserves notifications and keeps database checks', () => {
	const client = new Database(':memory:');
	client.pragma('foreign_keys=ON');
	try {
		const migrations = readMigrationFiles({ migrationsFolder: './drizzle' });
		for (const migration of migrations.slice(0, 7))
			for (const statement of migration.sql) client.exec(statement);
		seed(client);
		const insert = client.prepare(
			'INSERT INTO notification (id,user_id,type,delivery_key,created_at,delivered_at,read_at) VALUES (?,?,?,?,?,?,?)'
		);
		for (const type of ['sos', 'location_shared', 'location_expired', 'trusted_request'])
			insert.run(type, 'owner', type, `existing:${type}`, 1000, 2000, 3000);
		const before = client.prepare('SELECT * FROM notification ORDER BY id').all();
		client.transaction(() => {
			for (const statement of migrations[7].sql) client.exec(statement);
		})();
		assert.deepEqual(client.prepare('SELECT * FROM notification ORDER BY id').all(), before);
		insert.run('warning', 'owner', 'location_expiring', 'warning', 1000, null, null);
		assert.throws(() => insert.run('bad-type', 'owner', 'invalid', 'bad', 1000, null, null));
		assert.throws(() =>
			insert.run('bad-user', 'missing', 'location_expiring', 'bad', 1000, null, null)
		);
		assert.throws(() =>
			insert.run('duplicate', 'owner', 'location_expiring', 'warning', 1000, null, null)
		);
		assert.equal(client.pragma('foreign_keys', { simple: true }), 1);
		assert.deepEqual(client.pragma('foreign_key_check'), []);
		assert.equal(client.pragma('integrity_check', { simple: true }), 'ok');
	} finally {
		client.close();
	}
});

test('one-minute location warning is once per selected trusted recipient, never early or after stopping', () => {
	const { client, db } = database();
	try {
		seed(client);
		client.prepare('UPDATE user SET email_verified=1').run();
		const now = 1_000_000;
		const end = now + 120000;
		client
			.prepare(
				'INSERT INTO location_session (id,owner_profile_id,created_at,expires_at) VALUES (?,?,?,?)'
			)
			.run('warning-share', 'profile-owner', now, end);
		client
			.prepare('INSERT INTO location_recipient (id,session_id,user_id) VALUES (?,?,?)')
			.run('viewer', 'warning-share', 'requester');
		client
			.prepare(
				"INSERT INTO trusted_connection (id,owner_profile_id,requester_profile_id,relationship,status,approved_at) VALUES ('trusted','profile-owner','profile-requester','Friend','approved',?)"
			)
			.run(now);
		const notices = () =>
			client.prepare("SELECT * FROM notification WHERE type='location_expiring'").all();
		expireLocationSessions(db, new Date(end - 60001));
		assert.equal(notices().length, 0);
		expireLocationSessions(db, new Date(end - 60000));
		assert.deepEqual(
			notices()
				.map((row) => row.user_id)
				.sort(),
			['owner', 'requester']
		);
		client
			.prepare("UPDATE notification SET read_at=? WHERE type='location_expiring'")
			.run(end - 59000);
		expireLocationSessions(db, new Date(end - 30000));
		assert.equal(notices().length, 2);
		const insert = client.prepare(
			'INSERT INTO location_session (id,owner_profile_id,created_at,expires_at,cancelled_at) VALUES (?,?,?,?,?)'
		);
		insert.run('cancelled', 'profile-owner', now, end, now + 1);
		expireLocationSessions(db, new Date(end));
		assert.equal(notices().length, 2);
		insert.run('inactive', 'profile-owner', now, end + 60000, null);
		client.prepare("UPDATE user_profile SET deactivated_at=? WHERE id='profile-owner'").run(now);
		expireLocationSessions(db, new Date(end + 1000));
		assert.equal(notices().length, 2);
	} finally {
		client.close();
	}
});

test('advance warning excludes unselected, revoked, inactive and emergency-contact-only recipients', () => {
	const { client, db } = database();
	try {
		seed(client);
		client.prepare('UPDATE user SET email_verified=1').run();
		const now = 1000000;
		client
			.prepare(
				'INSERT INTO location_session (id,owner_profile_id,created_at,expires_at) VALUES (?,?,?,?)'
			)
			.run('share', 'profile-owner', now, now + 120000);
		for (const id of ['unselected', 'revoked', 'inactive', 'contact', 'both']) {
			client
				.prepare('INSERT INTO user (id,name,email,email_verified,updated_at) VALUES (?,?,?,1,?)')
				.run(id, id, `${id}@example.com`, now);
			client
				.prepare(
					'INSERT INTO user_profile (id,user_id,first_name,last_name,birthday,sex,phone,updated_at) VALUES (?,?,?,?,?,?,?,?)'
				)
				.run(`profile-${id}`, id, id, 'Recipient', '2000-01-01', 'Female', '+639171234567', now);
			if (id !== 'contact')
				client
					.prepare(
						"INSERT INTO trusted_connection (id,owner_profile_id,requester_profile_id,relationship,status,approved_at) VALUES (?, 'profile-owner', ?, 'Friend', 'approved', ?)"
					)
					.run(id, `profile-${id}`, now);
			if (id !== 'unselected')
				client
					.prepare(
						'INSERT INTO location_recipient (id,session_id,user_id,revoked_at) VALUES (?,?,?,?)'
					)
					.run(id, 'share', id, id === 'revoked' ? now : null);
			if (id === 'contact' || id === 'both')
				client
					.prepare(
						'INSERT INTO emergency_contact (id,profile_id,linked_user_id,first_name,last_name,phone,email,relationship) VALUES (?,?,?,?,?,?,?,?)'
					)
					.run(
						id,
						'profile-owner',
						id,
						id,
						'Recipient',
						'+639171234567',
						`${id}@example.com`,
						'Friend'
					);
		}
		client.prepare("UPDATE user SET banned=1 WHERE id='inactive'").run();
		expireLocationSessions(db, new Date(now + 60000));
		expireLocationSessions(db, new Date(now + 90000));
		assert.deepEqual(
			client
				.prepare("SELECT user_id FROM notification WHERE type='location_expiring' ORDER BY user_id")
				.all()
				.map((row) => row.user_id),
			['both', 'owner']
		);
	} finally {
		client.close();
	}
});

test('failed location warning transaction retries without a duplicate or lost warning', () => {
	const { client, db } = database();
	try {
		seed(client);
		client.prepare('UPDATE user SET email_verified=1').run();
		client
			.prepare(
				'INSERT INTO location_session (id,owner_profile_id,created_at,expires_at) VALUES (?,?,?,?)'
			)
			.run('warning-share', 'profile-owner', 1000000, 1120000);
		client
			.prepare('INSERT INTO location_recipient (id,session_id,user_id) VALUES (?,?,?)')
			.run('viewer', 'warning-share', 'requester');
		client
			.prepare(
				"INSERT INTO trusted_connection (id,owner_profile_id,requester_profile_id,relationship,status,approved_at) VALUES ('trusted','profile-owner','profile-requester','Friend','approved',1000000)"
			)
			.run();
		client.exec(
			"CREATE TRIGGER fail_warning BEFORE INSERT ON notification WHEN NEW.type='location_expiring' AND NEW.user_id='requester' BEGIN SELECT RAISE(ABORT,'isolated warning failure'); END;"
		);
		assert.throws(() => expireLocationSessions(db, new Date(1060000)));
		assert.equal(client.prepare('SELECT count(*) n FROM notification').get().n, 0);
		client.exec('DROP TRIGGER fail_warning');
		expireLocationSessions(db, new Date(1060000));
		expireLocationSessions(db, new Date(1060000));
		assert.equal(client.prepare('SELECT count(*) n FROM notification').get().n, 2);
	} finally {
		client.close();
	}
});

test('additive migration preserves existing auth data and can run again', () => {
	const client = new Database(':memory:');
	client.pragma('foreign_keys = ON');
	const migrations = readMigrationFiles({ migrationsFolder: './drizzle' });
	for (const statement of migrations[0].sql) client.exec(statement);
	client
		.prepare('INSERT INTO user (id,name,email,updated_at) VALUES (?,?,?,?)')
		.run('existing', 'Existing', 'existing@example.com', 1000);
	client
		.prepare('INSERT INTO task (id,title,priority) VALUES (?,?,?)')
		.run('old-task', 'Preserved', 1);
	// Execute the new migration against the pre-existing schema, without recreating auth tables.
	for (const statement of migrations[1].sql) client.exec(statement);
	assert.equal(client.prepare('SELECT count(*) AS count FROM user').get().count, 1);
	assert.equal(client.prepare('SELECT title FROM task').get().title, 'Preserved');
	assert.equal(client.pragma('foreign_key_check').length, 0);
	client.close();
	const fresh = database();
	migrate(fresh.db, { migrationsFolder: './drizzle' });
	assert.equal(
		fresh.client.prepare('SELECT count(*) AS count FROM __drizzle_migrations').get().count,
		migrations.length
	);
	fresh.client.close();
});

test('Drizzle stores profile and medical records; failed transactions roll back', () => {
	const { client, db } = database();
	db.insert(user)
		.values({ id: 'owner', name: 'Owner', email: 'owner@example.com', updatedAt: new Date() })
		.run();
	db.transaction((tx) => {
		tx.insert(profile)
			.values({
				id: 'profile',
				userId: 'owner',
				firstName: 'Casey',
				lastName: 'Reyes',
				birthday: '2000-01-01',
				sex: 'Female',
				phone: '+639171234567',
				updatedAt: new Date()
			})
			.run();
		tx.insert(medicalProfile).values({ profileId: 'profile', bloodType: 'O+' }).run();
	});
	assert.equal(
		db.select().from(profile).where(eq(profile.userId, 'owner')).get().firstName,
		'Casey'
	);
	assert.throws(() =>
		db.transaction((tx) => {
			tx.update(profile)
				.set({ firstName: 'Should roll back' })
				.where(eq(profile.id, 'profile'))
				.run();
			tx.insert(medicalProfile).values({ profileId: 'missing' }).run();
		})
	);
	assert.equal(db.select().from(profile).get().firstName, 'Casey');
	assert.throws(() => db.delete(user).where(eq(user.id, 'owner')).run());
	client.close();
});

test('account management migration preserves data and enforces email uniqueness and audit references', () => {
	const client = new Database(':memory:');
	try {
		client.pragma('foreign_keys = ON');
		const migrations = readMigrationFiles({ migrationsFolder: './drizzle' });
		for (const migration of migrations.slice(0, 2))
			for (const statement of migration.sql) client.exec(statement);
		client
			.prepare('INSERT INTO user (id,name,email,updated_at) VALUES (?,?,?,?)')
			.run('preserved', 'Preserved', 'Existing@example.com', 1000);
		for (const statement of migrations[2].sql) client.exec(statement);
		assert.equal(
			client.prepare('SELECT email FROM user WHERE id=?').get('preserved').email,
			'Existing@example.com'
		);
		assert.throws(() =>
			client
				.prepare('INSERT INTO user (id,name,email,updated_at) VALUES (?,?,?,?)')
				.run('duplicate', 'Duplicate', 'existing@EXAMPLE.com', 1000)
		);
		const audit = client.prepare(
			'INSERT INTO account_audit (id,actor_user_id,target_user_id,action) VALUES (?,?,?,?)'
		);
		assert.throws(() => audit.run('bad-target', 'preserved', 'missing', 'deactivated'));
		assert.throws(() => audit.run('bad-action', 'preserved', 'preserved', 'delete'));
		audit.run('history', 'preserved', 'preserved', 'dispatcher_created');
		assert.throws(() => client.prepare('DELETE FROM user WHERE id=?').run('preserved'));
		assert.equal(client.pragma('foreign_key_check').length, 0);
	} finally {
		client.close();
	}
});

test('admin creation migration preserves audit history and rejects unsupported actions', () => {
	const client = new Database(':memory:');
	try {
		client.pragma('foreign_keys = ON');
		const migrations = readMigrationFiles({ migrationsFolder: './drizzle' });
		for (const migration of migrations.slice(0, 4))
			for (const statement of migration.sql) client.exec(statement);
		client
			.prepare('INSERT INTO user (id,name,email,updated_at) VALUES (?,?,?,?)')
			.run('admin', 'Admin', 'admin@example.com', 1000);
		client
			.prepare(
				'INSERT INTO account_audit (id,actor_user_id,target_user_id,action,created_at) VALUES (?,?,?,?,?)'
			)
			.run('old-audit', 'admin', 'admin', 'dispatcher_created', 1000);
		const before = client.prepare('SELECT * FROM account_audit').all();
		for (const statement of migrations[4].sql) client.exec(statement);
		assert.deepEqual(client.prepare('SELECT * FROM account_audit').all(), before);
		const insert = client.prepare(
			'INSERT INTO account_audit (id,actor_user_id,target_user_id,action) VALUES (?,?,?,?)'
		);
		insert.run('new-audit', 'admin', 'admin', 'admin_created');
		assert.throws(() => insert.run('bad-action', 'admin', 'admin', 'delete'));
		assert.throws(() => insert.run('bad-reference', 'admin', 'missing', 'admin_created'));
		assert.equal(client.pragma('foreign_key_check').length, 0);
		assert.equal(client.pragma('integrity_check', { simple: true }), 'ok');
	} finally {
		client.close();
	}
});

test('MFA migration preserves old sessions without granting them MFA proof', () => {
	const client = new Database(':memory:');
	try {
		client.pragma('foreign_keys = ON');
		const migrations = readMigrationFiles({ migrationsFolder: './drizzle' });
		for (const migration of migrations.slice(0, 3))
			for (const statement of migration.sql) client.exec(statement);
		client
			.prepare('INSERT INTO user (id,name,email,role,updated_at) VALUES (?,?,?,?,?)')
			.run('staff', 'Staff', 'staff@example.com', 'admin', 1000);
		client
			.prepare('INSERT INTO session (id,token,user_id,expires_at,updated_at) VALUES (?,?,?,?,?)')
			.run('old-session', 'old-token', 'staff', Date.now() + 3600000, 1000);
		for (const statement of migrations[3].sql) client.exec(statement);
		const old = client.prepare('SELECT * FROM session WHERE id=?').get('old-session');
		assert.equal(old.token, 'old-token');
		assert.equal(old.mfa_verified_at, null);
		assert.equal(client.pragma('foreign_key_check').length, 0);
	} finally {
		client.close();
	}
});

test('cancellation migration preserves incidents, events and notifications and enforces review constraints', () => {
	const client = new Database(':memory:');
	try {
		client.pragma('foreign_keys=ON');
		const migrations = readMigrationFiles({ migrationsFolder: './drizzle' });
		for (const migration of migrations.slice(0, 5))
			for (const statement of migration.sql) client.exec(statement);
		seed(client);
		client
			.prepare(
				'INSERT INTO incident (id,person_profile_id,caller_user_id,caller_name,latitude,longitude,idempotency_key) VALUES (?,?,?,?,?,?,?)'
			)
			.run('incident', 'profile-owner', 'requester', 'Requester', 14, 121, 'retry');
		client
			.prepare(
				'INSERT INTO incident_event (id,incident_id,actor_user_id,type,notes) VALUES (?,?,?,?,?)'
			)
			.run('event', 'incident', 'requester', 'created', 'Preserved event');
		client
			.prepare(
				'INSERT INTO notification (id,user_id,incident_id,type,delivery_key) VALUES (?,?,?,?,?)'
			)
			.run('notice', 'owner', 'incident', 'sos', 'sos:incident:owner');
		const names = ['incident', 'incident_event', 'notification', 'user_profile'];
		const before = names.map((name) => client.prepare(`SELECT * FROM ${name} ORDER BY id`).all());
		for (const statement of migrations[5].sql) client.exec(statement);
		assert.deepEqual(
			names.map((name) => client.prepare(`SELECT * FROM ${name} ORDER BY id`).all()),
			before
		);
		const add = client.prepare(
			'INSERT INTO incident_cancellation (id,incident_id,requester_user_id,reason) VALUES (?,?,?,?)'
		);
		assert.throws(() => add.run('blank', 'incident', 'owner', ' '));
		assert.throws(() => add.run('missing', 'missing', 'owner', 'Wrong incident'));
		add.run('request', 'incident', 'owner', 'I am safe.');
		assert.throws(() => add.run('duplicate', 'incident', 'owner', 'Duplicate'));
		assert.throws(() =>
			client
				.prepare("UPDATE incident_cancellation SET decision='approved' WHERE id='request'")
				.run()
		);
		assert.throws(() =>
			client
				.prepare(
					"UPDATE incident_cancellation SET decision='approved',reviewed_at=0,reviewed_by_user_id='dispatcher' WHERE id='request'"
				)
				.run()
		);
		client
			.prepare(
				"UPDATE incident_cancellation SET decision='approved',reviewed_at=?,reviewed_by_user_id='dispatcher' WHERE id='request'"
			)
			.run(Date.now() + 1000);
		assert.equal(client.pragma('foreign_key_check').length, 0);
		assert.equal(client.pragma('integrity_check', { simple: true }), 'ok');
	} finally {
		client.close();
	}
});

test('AI summary migration preserves reports and enforces generation/review consistency', () => {
	const client = new Database(':memory:');
	client.pragma('foreign_keys=ON');
	try {
		const migrations = readMigrationFiles({ migrationsFolder: './drizzle' });
		for (const migration of migrations.slice(0, 6))
			for (const statement of migration.sql) client.exec(statement);
		seed(client);
		client
			.prepare(
				"INSERT INTO incident (id,person_profile_id,caller_user_id,caller_name,latitude,longitude,idempotency_key) VALUES ('incident','profile-owner','owner','Caller',14,120,'retry')"
			)
			.run();
		client
			.prepare(
				"INSERT INTO incident_event (id,incident_id,actor_user_id,type,notes) VALUES ('note','incident','dispatcher','note','Caller reports chest pain.')"
			)
			.run();
		client
			.prepare(
				"INSERT INTO report (id,incident_id,summary) VALUES ('report','incident','Existing human summary.')"
			)
			.run();
		const before = client.prepare('SELECT * FROM report').get();
		for (const statement of migrations[6].sql) client.exec(statement);
		const after = client.prepare('SELECT * FROM report').get();
		assert.deepEqual(
			Object.fromEntries(Object.keys(before).map((key) => [key, after[key]])),
			before
		);
		assert.equal(after.summary_request_id, null);
		const insert = client.prepare(
			'INSERT INTO ai_summary_request (id,incident_id,requested_by_user_id,source_note_id,input_hash,model) VALUES (?,?,?,?,?,?)'
		);
		assert.throws(() => insert.run('bad', 'incident', 'dispatcher', 'note', 'bad', 'gpt-4.1-mini'));
		assert.throws(() =>
			insert.run('missing', 'missing', 'dispatcher', 'note', 'a'.repeat(64), 'gpt-4.1-mini')
		);
		insert.run('request', 'incident', 'dispatcher', 'note', 'a'.repeat(64), 'gpt-4.1-mini');
		assert.throws(() =>
			insert.run('duplicate', 'incident', 'dispatcher', 'note', 'b'.repeat(64), 'gpt-4.1-mini')
		);
		assert.throws(() =>
			client.prepare("UPDATE ai_summary_request SET status='completed' WHERE id='request'").run()
		);
		client
			.prepare(
				"UPDATE ai_summary_request SET status='completed',summary='Caller reports chest pain.',finished_at=max(created_at,?) WHERE id='request'"
			)
			.run(Date.now());
		assert.throws(() =>
			client
				.prepare("UPDATE ai_summary_request SET reviewed_at=? WHERE id='request'")
				.run(Date.now())
		);
		client
			.prepare(
				"UPDATE ai_summary_request SET reviewed_at=?,reviewed_by_user_id='dispatcher' WHERE id='request'"
			)
			.run(Date.now());
		client.prepare("UPDATE report SET summary_request_id='request' WHERE id='report'").run();
		assert.equal(client.pragma('integrity_check', { simple: true }), 'ok');
		assert.deepEqual(client.pragma('foreign_key_check'), []);
	} finally {
		client.close();
	}
});

test('foreign keys, duplicates, self-trust, approval, and OTP limits are enforced', () => {
	const { client } = database();
	seed(client);
	const connect = client.prepare(
		'INSERT INTO trusted_connection (id,owner_profile_id,requester_profile_id,relationship,status,approved_at) VALUES (?,?,?,?,?,?)'
	);
	assert.throws(() =>
		connect.run('self', 'profile-owner', 'profile-owner', 'Self', 'pending', null)
	);
	assert.throws(() =>
		connect.run('missing', 'profile-owner', 'missing', 'Friend', 'pending', null)
	);
	assert.throws(() =>
		connect.run('bad-approval', 'profile-owner', 'profile-requester', 'Friend', 'approved', null)
	);
	connect.run('trusted', 'profile-owner', 'profile-requester', 'Friend', 'pending', null);
	assert.throws(() =>
		connect.run('duplicate', 'profile-owner', 'profile-requester', 'Friend', 'pending', null)
	);
	const otp = client.prepare(
		'INSERT INTO verification_request (id,user_id,purpose,code_hash,created_at,expires_at,attempts) VALUES (?,?,?,?,?,?,?)'
	);
	assert.throws(() => otp.run('plain', 'owner', 'email', '123456', 1000, 2000, 0));
	assert.throws(() => otp.run('expired', 'owner', 'email', 'a'.repeat(64), 2000, 1000, 0));
	assert.throws(() => otp.run('attempts', 'owner', 'email', 'a'.repeat(64), 1000, 2000, 6));
	assert.throws(() =>
		otp.run('unbound', 'owner', 'trusted_approval', 'a'.repeat(64), 1000, 2000, 0)
	);
	client.close();
});

test('incidents reject invalid coordinates, assignment and resolution; retries are unique', () => {
	const { client } = database();
	seed(client);
	const add = client.prepare(
		'INSERT INTO incident (id,person_profile_id,caller_user_id,caller_name,latitude,longitude,idempotency_key,created_at) VALUES (?,?,?,?,?,?,?,?)'
	);
	assert.throws(() => add.run('bad', 'profile-owner', 'owner', 'Owner', 91, 121, 'retry', 1000));
	add.run('incident', 'profile-owner', 'owner', 'Owner', 14, 121, 'retry', 1000);
	assert.throws(() =>
		add.run('duplicate', 'profile-owner', 'owner', 'Owner', 14, 121, 'retry', 1000)
	);
	assert.throws(() =>
		client.prepare("UPDATE incident SET status='In progress' WHERE id='incident'").run()
	);
	client
		.prepare(
			"UPDATE incident SET status='In progress', dispatcher_user_id='dispatcher',confirmed_at=1500 WHERE id='incident'"
		)
		.run();
	assert.throws(() =>
		client.prepare("UPDATE incident SET status='Resolved' WHERE id='incident'").run()
	);
	assert.throws(() =>
		client.prepare("UPDATE incident SET status='Resolved',ended_at=500 WHERE id='incident'").run()
	);
	client.prepare("UPDATE incident SET status='Resolved',ended_at=2000 WHERE id='incident'").run();
	assert.equal(
		client.prepare("SELECT ended_at FROM incident WHERE id='incident'").get().ended_at,
		2000
	);
	client.close();
});

test('location durations, coordinates, and recipient duplicates are rejected', () => {
	const { client } = database();
	seed(client);
	const add = client.prepare(
		'INSERT INTO location_session (id,owner_profile_id,created_at,expires_at) VALUES (?,?,?,?)'
	);
	assert.throws(() => add.run('too-short', 'profile-owner', 1000, 1001));
	assert.throws(() => add.run('too-long', 'profile-owner', 1000, 14401001));
	add.run('share', 'profile-owner', 1000, 61000);
	const recipient = client.prepare(
		'INSERT INTO location_recipient (id,session_id,user_id) VALUES (?,?,?)'
	);
	recipient.run('r1', 'share', 'requester');
	assert.throws(() => recipient.run('r2', 'share', 'requester'));
	assert.throws(() =>
		client
			.prepare(
				'INSERT INTO location_point (id,session_id,latitude,longitude,accuracy,recorded_at) VALUES (?,?,?,?,?,?)'
			)
			.run('bad', 'share', 14, 181, 0, 1000)
	);
	client.close();
});

const valid = {
	firstName: 'Casey',
	lastName: 'Reyes',
	birthday: '2000-01-01',
	sex: 'Female',
	phone: '+63 917 123 4567',
	medical: {
		bloodType: 'O+',
		chronicCondition: '',
		allergies: '',
		currentMedications: '',
		additionalInformation: ''
	},
	emergencyContacts: [
		{
			firstName: 'Robin',
			lastName: 'Reyes',
			phone: '+639171234567',
			email: 'robin@example.com',
			relationship: 'Sibling'
		}
	]
};
test('Zod rejects privileged fields, invalid dates, oversized text, and malformed payloads', () => {
	assert.equal(profileInput.parse(valid).phone, '+639171234567');
	for (const input of [
		{ ...valid, role: 'admin' },
		{ ...valid, userId: 'other' },
		{ ...valid, birthday: '2001-02-29' },
		{ ...valid, birthday: '2999-01-01' },
		{ ...valid, emergencyContacts: [] },
		{ ...valid, medical: { ...valid.medical, additionalInformation: 'a'.repeat(2001) } },
		{ ...valid, emergencyContacts: [{ ...valid.emergencyContacts[0], linkedUserId: 'other' }] }
	])
		assert.equal(profileInput.safeParse(input).success, false);
	assert.equal(confirmationInput.safeParse({ verballyConfirmed: false }).success, false);
	assert.equal(otpInput.safeParse({ requestId: crypto.randomUUID(), code: '123' }).success, false);
	assert.equal(
		incidentInput.safeParse({
			personProfileId: crypto.randomUUID(),
			latitude: 14,
			longitude: 121,
			locationLabel: '',
			idempotencyKey: crypto.randomUUID(),
			dispatcherUserId: 'attacker'
		}).success,
		false
	);
	assert.equal(
		locationSessionInput.safeParse({ durationMinutes: 241, recipientUserIds: ['recipient'] })
			.success,
		false
	);
	assert.equal(
		locationPointInput.safeParse({
			latitude: 14,
			longitude: 121,
			accuracy: 2,
			recordedAt: '2000-01-01T00:00:00Z'
		}).success,
		false
	);
});
