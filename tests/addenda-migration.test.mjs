import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, rmdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { readMigrationFiles } from 'drizzle-orm/migrator';

test('0011 adds report addenda without changing existing accounts, incidents, notes, approved AI or seed history', () => {
	const directory = mkdtempSync(join(tmpdir(), 'handlink-addenda-migration-'));
	const filename = join(directory, 'migration.db');
	const client = new Database(filename);
	client.pragma('foreign_keys=ON');
	try {
		const journal = JSON.parse(readFileSync('./drizzle/meta/_journal.json', 'utf8'));
		const index = journal.entries.findIndex((entry) => entry.tag === '0011_incident_addenda');
		assert.equal(index, 11, 'Expected the addenda migration after 0010');
		const migrations = readMigrationFiles({ migrationsFolder: './drizzle' });
		for (const migration of migrations.slice(0, index)) {
			for (const statement of migration.sql) client.exec(statement);
		}
		const now = 1000000;
		for (const [id, role] of [
			['caller', 'user'],
			['dispatcher', 'dispatcher'],
			['admin', 'admin']
		]) {
			client
				.prepare(
					'INSERT INTO user (id,name,email,email_verified,role,updated_at) VALUES (?,?,?,1,?,?)'
				)
				.run(id, id, `${id}@example.com`, role, now);
		}
		client
			.prepare(
				'INSERT INTO user_profile (id,user_id,first_name,last_name,birthday,sex,phone,updated_at) VALUES (?,?,?,?,?,?,?,?)'
			)
			.run('profile', 'caller', 'Test', 'Caller', '2000-01-01', 'Female', '+639171234567', now);
		client
			.prepare('INSERT INTO medical_profile (profile_id,allergies) VALUES (?,?)')
			.run('profile', 'Existing private allergy');
		client
			.prepare(
				"INSERT INTO incident (id,person_profile_id,caller_user_id,caller_name,dispatcher_user_id,status,latitude,longitude,idempotency_key,created_at,confirmed_at,ended_at) VALUES ('incident','profile','caller','Test Caller','dispatcher','Resolved',14,121,'existing-retry',?,?,?)"
			)
			.run(now, now + 1, now + 100);
		client
			.prepare(
				"INSERT INTO incident_event (id,incident_id,actor_user_id,type,notes,created_at) VALUES ('note','incident','dispatcher','note',?,?)"
			)
			.run('Existing resolved notes must remain unchanged.', now + 2);
		client
			.prepare(
				"INSERT INTO ai_summary_request (id,incident_id,requested_by_user_id,source_note_id,input_hash,model,status,summary,created_at,finished_at,reviewed_at,reviewed_by_user_id) VALUES ('ai','incident','dispatcher','note',?,'isolated-test-model','completed','Existing approved summary',?,?,?,'dispatcher')"
			)
			.run('a'.repeat(64), now + 3, now + 4, now + 5);
		client
			.prepare(
				"INSERT INTO report (id,incident_id,summary,created_at,reviewed_by_user_id,reviewed_at,summary_request_id) VALUES ('report','incident','Existing approved summary',?,'dispatcher',?,'ai')"
			)
			.run(now + 5, now + 5);
		client
			.prepare("INSERT INTO seed_history (key,completed_at) VALUES ('initial-admin-v1',?)")
			.run(now);
		const existingTables = [
			'user',
			'user_profile',
			'medical_profile',
			'incident',
			'incident_reference',
			'incident_event',
			'ai_summary_request',
			'report',
			'seed_history'
		];
		const snapshot = () =>
			Object.fromEntries(
				existingTables.map((table) => [
					table,
					client.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()
				])
			);
		const before = snapshot();
		client.transaction(() => {
			for (const statement of migrations[index].sql) client.exec(statement);
		})();
		assert.deepEqual(snapshot(), before);
		assert.deepEqual(client.prepare('SELECT * FROM incident_addendum').all(), []);
		const insert = client.prepare(
			'INSERT INTO incident_addendum (id,incident_id,actor_user_id,notes,created_at) VALUES (?,?,?,?,?)'
		);
		insert.run('addendum', 'incident', 'dispatcher', 'New follow-up after resolution.', now + 200);
		assert.deepEqual(client.prepare('SELECT * FROM incident_addendum').get(), {
			id: 'addendum',
			incident_id: 'incident',
			actor_user_id: 'dispatcher',
			notes: 'New follow-up after resolution.',
			created_at: now + 200
		});
		assert.throws(
			() => insert.run('missing-incident', 'missing', 'dispatcher', 'Invalid incident.', now + 201),
			/FOREIGN KEY/
		);
		assert.throws(
			() => insert.run('missing-actor', 'incident', 'missing', 'Invalid actor.', now + 201),
			/FOREIGN KEY/
		);
		assert.throws(() => insert.run('blank', 'incident', 'dispatcher', '   ', now + 201), /CHECK/);
		assert.throws(
			() => insert.run('too-long', 'incident', 'dispatcher', 'x'.repeat(2001), now + 201),
			/CHECK/
		);
		assert.throws(
			() => insert.run('addendum', 'incident', 'dispatcher', 'Duplicate request.', now + 201),
			/UNIQUE/
		);
		assert.throws(
			() => client.prepare("DELETE FROM incident WHERE id='incident'").run(),
			/FOREIGN KEY/
		);
		assert.throws(
			() => client.prepare("DELETE FROM user WHERE id='dispatcher'").run(),
			/FOREIGN KEY/
		);
		assert.deepEqual(snapshot(), before);
		assert.equal(client.pragma('foreign_keys', { simple: true }), 1);
		assert.deepEqual(client.pragma('foreign_key_check'), []);
		assert.equal(client.pragma('integrity_check', { simple: true }), 'ok');
	} finally {
		client.close();
		unlinkSync(filename);
		rmdirSync(directory);
	}
});
