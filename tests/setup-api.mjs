import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

if (!process.env.DATABASE_URL || process.env.DATABASE_URL !== process.env.HANDLINK_TEST_DB) {
	throw new Error('API tests require an isolated test database.');
}
const client = new Database(process.env.DATABASE_URL);
client.pragma('foreign_keys = ON');
migrate(drizzle(client), { migrationsFolder: './drizzle' });
client.close();
