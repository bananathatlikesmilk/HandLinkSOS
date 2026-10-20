import { defineConfig } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Tests use their own database, never the configured development database.
process.env.HANDLINK_TEST_DB ??= join(mkdtempSync(join(tmpdir(), 'handlink-api-')), 'test.db');
const port = 4174;
const origin = `http://127.0.0.1:${port}`;
export default defineConfig({
	testMatch: [
		'tests/profile.api.ts',
		'tests/usability.api.ts',
		'tests/usability.frontend.ts',
		'tests/accounts.api.ts',
		'tests/staff-profile.frontend.ts',
		'tests/incidents.api.ts',
		'tests/sos-consent.api.ts',
		'tests/sos-consent.frontend.ts',
		'tests/sharing.api.ts',
		'tests/sharing.frontend.ts',
		'tests/native.frontend.ts',
		'tests/permissions.frontend.ts',
		'tests/incidents.frontend.ts'
	],
	workers: 1,
	use: { baseURL: origin },
	webServer: {
		command: `node tests/setup-api.mjs && pnpm build && pnpm preview --host 127.0.0.1 --port ${port} --strictPort`,
		url: origin,
		timeout: 120000,
		env: {
			HANDLINK_TEST_DB: process.env.HANDLINK_TEST_DB,
			DATABASE_URL: process.env.HANDLINK_TEST_DB,
			// Tests must never use the developer's real SMTP account.
			SMTP_HOST: '',
			SMTP_PORT: '',
			SMTP_USER: '',
			SMTP_PASSWORD: '',
			SMTP_FROM: '',
			FIREBASE_SERVICE_ACCOUNT_FILE: '',
			OPENAI_API_KEY: '',
			OPENAI_SUMMARY_MODEL: '',
			ORIGIN: origin,
			BETTER_AUTH_SECRET: 'isolated-test-secret-only-012345678901234567890123456789'
		}
	}
});
