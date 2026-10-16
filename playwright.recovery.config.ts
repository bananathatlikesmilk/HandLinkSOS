import { defineConfig } from '@playwright/test';
import base from './playwright.database.config';

const server = base.webServer;
if (!server || Array.isArray(server))
	throw new Error('Recovery tests require one isolated server.');

// Enable OTP routes without a usable mail server. Tests seed hashed codes locally
// or intercept only the send request; no Gmail credentials or real messages are used.
export default defineConfig({
	...base,
	testMatch: 'tests/recovery.api.ts',
	webServer: {
		...server,
		command: 'node tests/setup-api.mjs && pnpm dev --host 127.0.0.1 --port 4174 --strictPort',
		env: {
			...server.env,
			SMTP_HOST: '127.0.0.1',
			SMTP_PORT: '1',
			SMTP_USER: 'isolated-test',
			SMTP_PASSWORD: 'isolated-test',
			SMTP_FROM: 'test@example.com'
		}
	}
});
