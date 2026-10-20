import { defineConfig } from '@playwright/test';
import base from './playwright.database.config';

export default defineConfig({
	...base,
	testMatch: ['tests/ai-summary.api.ts', 'tests/ai-summary.frontend.ts'],
	webServer: {
		...base.webServer,
		env: {
			...(!Array.isArray(base.webServer) ? base.webServer?.env : {}),
			OLLAMA_SUMMARY_MODEL: 'qwen2.5:3b',
			OLLAMA_SERVER_URL: 'http://127.0.0.1:11434',
			NODE_OPTIONS: '--import=./tests/ollama-mock.mjs'
		}
	}
});
