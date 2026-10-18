import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import { hashPassword } from 'better-auth/crypto';
import { seedHistory } from '../src/lib/server/db/schema.ts';
import { adminInput, insertAdmin } from './create-admin.mjs';

const ADMIN_SEED_KEY = 'initial-admin-v1';

export async function seedAdmin(db: BetterSQLite3Database, input?: unknown) {
	const completed = () =>
		db.select().from(seedHistory).where(eq(seedHistory.key, ADMIN_SEED_KEY)).get();
	if (completed()) return 'already-seeded';
	if (input === undefined) return 'not-configured';
	const values = adminInput.parse(input);
	const password = await hashPassword(values.password);
	return db.transaction(
		(tx) => {
			// Recheck after taking the write lock: another startup may have seeded meanwhile.
			if (tx.select().from(seedHistory).where(eq(seedHistory.key, ADMIN_SEED_KEY)).get()) {
				return 'already-seeded';
			}
			insertAdmin(tx, values, password);
			tx.insert(seedHistory).values({ key: ADMIN_SEED_KEY, completedAt: new Date() }).run();
			return 'seeded';
		},
		{ behavior: 'immediate' }
	);
}

async function main() {
	if (fs.existsSync('.env')) process.loadEnvFile('.env');
	if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set.');
	const client = new Database(path.resolve(process.env.DATABASE_URL), { fileMustExist: true });
	client.pragma('foreign_keys = ON');
	client.pragma('busy_timeout = 5000');
	try {
		const name = process.env.SEED_ADMIN_NAME;
		const email = process.env.SEED_ADMIN_EMAIL;
		const password = process.env.SEED_ADMIN_PASSWORD;
		const input = name || email || password ? { name, email, password } : undefined;
		const result = await seedAdmin(drizzle(client), input);
		if (result === 'seeded') {
			console.log(
				'Admin seeded once. Verify its email at /user/verify, then sign in at /admin/login.'
			);
		} else if (result === 'already-seeded') {
			console.log('Admin seed already completed; no accounts changed.');
		} else {
			console.log(
				'Admin seed skipped: SEED_ADMIN_NAME, SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD are not configured.'
			);
		}
	} finally {
		client.close();
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	main().catch(() => {
		// Never print validation input, database values, or initial credentials to startup logs.
		console.error(
			'Admin seed failed. Check all three SEED_ADMIN settings, migration status, and email uniqueness. No partial seed was saved.'
		);
		process.exitCode = 1;
	});
}
