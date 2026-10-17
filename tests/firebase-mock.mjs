import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { Messaging } from 'firebase-admin/messaging';

if (
	!process.env.HANDLINK_TEST_DB ||
	process.env.DATABASE_URL !== process.env.HANDLINK_TEST_DB ||
	process.env.FIREBASE_SERVICE_ACCOUNT_FILE !== process.env.HANDLINK_TEST_FIREBASE ||
	JSON.parse(readFileSync(process.env.HANDLINK_TEST_FIREBASE, 'utf8')).project_id !==
		'handlink-isolated-test'
) {
	throw new Error('Firebase mock requires isolated test credentials and database.');
}
// Real Google authentication and push delivery must never run in automated fixtures.
Messaging.prototype.send = async function (message) {
	const db = new Database(process.env.HANDLINK_TEST_DB);
	try {
		db.exec('CREATE TABLE IF NOT EXISTS test_push_message (payload TEXT NOT NULL)');
		db.prepare('INSERT INTO test_push_message (payload) VALUES (?)').run(JSON.stringify(message));
	} finally {
		db.close();
	}
	return 'isolated-fixture-message';
};
