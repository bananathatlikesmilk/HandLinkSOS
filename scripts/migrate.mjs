import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

if (fs.existsSync('.env')) process.loadEnvFile('.env');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
const target = path.resolve(process.env.DATABASE_URL);
const existed = fs.existsSync(target);
const client = new Database(target);
client.pragma('foreign_keys = ON');
client.pragma('busy_timeout = 5000');
try {
	if (existed) {
		fs.mkdirSync('.db-backups', { recursive: true, mode: 0o700 });
		const backup = path.resolve('.db-backups', `before-migration-${Date.now()}.sqlite`);
		await client.backup(backup);
		fs.chmodSync(backup, 0o600);
		console.log('Database backup created in .db-backups. Keep this folder private.');
	}
	migrate(drizzle(client), { migrationsFolder: './drizzle' });
	const violations = client.pragma('foreign_key_check');
	if (violations.length) throw new Error('Database foreign key verification failed.');
	console.log('Migrations applied; foreign key check passed.');
} finally {
	client.close();
}
