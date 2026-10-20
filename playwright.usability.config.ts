import { defineConfig } from '@playwright/test';
import base from './playwright.recovery.config';

// Real isolated database and application; mail delivery stays disabled by an unusable local SMTP.
export default defineConfig({
	...base,
	webServer: { ...base.webServer, timeout: 240000 },
	testMatch: [
		'tests/usability.api.ts',
		'tests/usability.frontend.ts',
		'tests/incidents.api.ts',
		'tests/incidents.frontend.ts',
		'tests/account.frontend.ts',
		'tests/trusted.frontend.ts',
		'tests/sos-consent.frontend.ts',
		'tests/permissions.frontend.ts',
		'tests/native.frontend.ts',
		'tests/mfa.api.ts',
		'tests/recovery.api.ts',
		'tests/profile.api.ts'
	]
});
