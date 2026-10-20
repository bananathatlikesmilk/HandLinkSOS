import { defineConfig } from '@playwright/test';
import base from './playwright.database.config';

export default defineConfig({
	...base,
	testMatch: ['tests/ai-summary.api.ts', 'tests/ai-summary.frontend.ts', 'tests/ai-providers.ts'],
	webServer: {
		...base.webServer,
		timeout: 240000,
		env: {
			...(!Array.isArray(base.webServer) ? base.webServer?.env : {}),
			OLLAMA_SUMMARY_MODEL: 'qwen2.5:3b',
			OLLAMA_SERVER_URL: 'http://127.0.0.1:11434',
			GEMINI_API_KEY: 'isolated-gemini-key-not-real',
			GEMINI_SUMMARY_MODEL: 'gemini-3.5-flash-lite',
			NODE_OPTIONS: '--import=./tests/ollama-mock.mjs'
		}
	}
});
