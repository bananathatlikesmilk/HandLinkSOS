import fs from 'node:fs';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../src/lib/server/db/schema.ts';
import { expireLocationSessions } from '../src/lib/server/location-expiry.ts';

if (fs.existsSync('.env')) process.loadEnvFile('.env');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
const client = new Database(process.env.DATABASE_URL);
client.pragma('foreign_keys = ON');
client.pragma('busy_timeout = 5000');
try {
	const count = expireLocationSessions(drizzle(client, { schema }));
	console.log(`Processed ${count} expired sharing sessions.`);
} finally {
	client.close();
}
