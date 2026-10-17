import { defineConfig } from '@playwright/test';
import { generateKeyPairSync } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import base from './playwright.database.config';

const credentialFile = join(dirname(process.env.HANDLINK_TEST_DB!), 'firebase-test.json');
const { privateKey } = generateKeyPairSync('rsa', {
	modulusLength: 2048,
	privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
	publicKeyEncoding: { type: 'spki', format: 'pem' }
});
writeFileSync(
	credentialFile,
	JSON.stringify({
		project_id: 'handlink-isolated-test',
		client_email: 'fixture@handlink-isolated-test.iam.gserviceaccount.com',
		private_key: privateKey
	}),
	{ mode: 0o600 }
);
export default defineConfig({
	...base,
	testMatch: 'tests/push.api.ts',
	webServer: {
		...base.webServer,
		env: {
			...(!Array.isArray(base.webServer) ? base.webServer?.env : {}),
			FIREBASE_SERVICE_ACCOUNT_FILE: credentialFile,
			HANDLINK_TEST_FIREBASE: credentialFile,
			NODE_OPTIONS: '--import=./tests/firebase-mock.mjs'
		}
	}
});
