import assert from 'node:assert/strict';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { verifyPassword } from 'better-auth/crypto';
import { createAdmin } from '../scripts/create-admin.mjs';

test('local admin provisioning validates input, hashes credentials, and preserves email verification', async () => {
	const client = new Database(':memory:');
	try {
		client.pragma('foreign_keys = ON');
		const db = drizzle(client);
		migrate(db, { migrationsFolder: './drizzle' });
		const input = {
			name: 'Administrator',
			email: 'Admin@example.com',
			password: 'test-only-password-1234'
		};
		for (const invalid of [
			{ ...input, email: 'invalid' },
			{ ...input, password: 'short' },
			{ ...input, role: 'admin' }
		]) {
			await assert.rejects(createAdmin(db, invalid));
		}
		assert.equal(client.prepare('SELECT count(*) AS count FROM user').get().count, 0);
		const created = await createAdmin(db, input);
		const identity = client.prepare('SELECT * FROM user WHERE id = ?').get(created.id);
		assert.equal(identity.role, 'admin');
		assert.equal(identity.email, 'admin@example.com');
		assert.equal(identity.email_verified, 0);
		const credential = client.prepare('SELECT * FROM account WHERE user_id = ?').get(created.id);
		assert.equal(credential.provider_id, 'credential');
		assert.equal(credential.account_id, created.id);
		assert.notEqual(credential.password, input.password);
		assert.equal(
			await verifyPassword({ password: input.password, hash: credential.password }),
			true
		);
		await assert.rejects(
			createAdmin(db, { ...input, email: 'ADMIN@example.com' }),
			/already has an account/
		);
		assert.equal(client.prepare('SELECT count(*) AS count FROM user').get().count, 1);
		assert.equal(client.prepare('SELECT count(*) AS count FROM account').get().count, 1);
		client.exec(
			"CREATE TRIGGER reject_credential BEFORE INSERT ON account BEGIN SELECT RAISE(ABORT, 'test failure'); END"
		);
		await assert.rejects(
			createAdmin(db, { ...input, email: 'second@example.com' }),
			/test failure/
		);
		assert.equal(client.prepare('SELECT count(*) AS count FROM user').get().count, 1);
	} finally {
		client.close();
	}
});
