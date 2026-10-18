import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { verifyPassword } from 'better-auth/crypto';
import { seedAdmin } from '../scripts/seed.ts';

const input = {
	name: 'Initial Admin',
	email: 'Seed@example.com',
	password: 'test-only-admin-password-1234'
};

function database(file = ':memory:') {
	const client = new Database(file);
	client.pragma('foreign_keys = ON');
	client.pragma('busy_timeout = 5000');
	const db = drizzle(client);
	migrate(db, { migrationsFolder: './drizzle' });
	return { client, db };
}

test('admin seed commits once, hashes credentials, and never resets accounts on restart', async () => {
	const { client, db } = database();
	try {
		assert.equal(await seedAdmin(db, input), 'seeded');
		const identity = client.prepare('SELECT * FROM user').get();
		assert.equal(identity.email, 'seed@example.com');
		assert.equal(identity.role, 'admin');
		assert.equal(identity.email_verified, 1);
		assert.equal(identity.two_factor_enabled, 0);
		const credential = client.prepare('SELECT * FROM account').get();
		assert.equal(credential.user_id, identity.id);
		assert.equal(credential.provider_id, 'credential');
		assert.notEqual(credential.password, input.password);
		assert.equal(
			await verifyPassword({ password: input.password, hash: credential.password }),
			true
		);
		assert.equal(client.prepare('SELECT count(*) AS n FROM seed_history').get().n, 1);
		assert.equal(await seedAdmin(db), 'already-seeded');
		assert.equal(
			await seedAdmin(db, { ...input, email: 'different@example.com' }),
			'already-seeded'
		);
		assert.equal(await seedAdmin(db, { password: 'invalid' }), 'already-seeded');
		assert.equal(client.prepare('SELECT count(*) AS n FROM user').get().n, 1);
		assert.equal(
			client.prepare('SELECT password FROM account').get().password,
			credential.password
		);
		assert.deepEqual(client.pragma('foreign_key_check'), []);
	} finally {
		client.close();
	}
});

test('missing or invalid configuration does not consume the seed', async () => {
	const { client, db } = database();
	try {
		assert.equal(await seedAdmin(db), 'not-configured');
		for (const invalid of [
			{ ...input, password: 'short' },
			{ ...input, email: 'invalid' },
			{ email: input.email },
			{ ...input, role: 'admin' }
		])
			await assert.rejects(seedAdmin(db, invalid));
		assert.equal(client.prepare('SELECT count(*) AS n FROM seed_history').get().n, 0);
		assert.equal(client.prepare('SELECT count(*) AS n FROM user').get().n, 0);
		assert.equal(await seedAdmin(db, input), 'seeded');
	} finally {
		client.close();
	}
});

test('seed failures roll back both credentials and marker and never promote an existing account', async () => {
	const { client, db } = database();
	try {
		client.exec(
			"CREATE TRIGGER reject_marker BEFORE INSERT ON seed_history BEGIN SELECT RAISE(ABORT, 'test failure'); END"
		);
		await assert.rejects(seedAdmin(db, input), /test failure/);
		for (const table of ['user', 'account', 'seed_history']) {
			assert.equal(client.prepare(`SELECT count(*) AS n FROM ${table}`).get().n, 0);
		}
		client.exec('DROP TRIGGER reject_marker');
		client
			.prepare('INSERT INTO user (id, name, email, role) VALUES (?, ?, ?, ?)')
			.run('existing', 'Existing', 'SEED@example.com', 'user');
		await assert.rejects(seedAdmin(db, input), /already has an account/);
		assert.equal(client.prepare('SELECT role FROM user').get().role, 'user');
		assert.equal(client.prepare('SELECT email_verified FROM user').get().email_verified, 0);
		assert.equal(client.prepare('SELECT count(*) AS n FROM seed_history').get().n, 0);
		assert.equal(client.prepare('SELECT count(*) AS n FROM account').get().n, 0);
	} finally {
		client.close();
	}
});

test('two startup connections create only one admin and persist completion across reopening', async () => {
	const directory = mkdtempSync(join(tmpdir(), 'handlink-seed-test-'));
	const file = join(directory, 'seed.db');
	const first = database(file);
	const second = database(file);
	try {
		const results = await Promise.all([seedAdmin(first.db, input), seedAdmin(second.db, input)]);
		assert.deepEqual(results.sort(), ['already-seeded', 'seeded']);
		assert.equal(first.client.prepare('SELECT count(*) AS n FROM user').get().n, 1);
		assert.equal(first.client.prepare('SELECT count(*) AS n FROM account').get().n, 1);
	} finally {
		first.client.close();
		second.client.close();
	}
	try {
		const reopened = database(file);
		try {
			assert.equal(await seedAdmin(reopened.db), 'already-seeded');
		} finally {
			reopened.client.close();
		}
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});
