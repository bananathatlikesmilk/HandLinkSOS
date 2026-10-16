import { defineConfig } from '@playwright/test';
import base from './playwright.recovery.config';

export default defineConfig({
	...base,
	testMatch: ['tests/trusted.api.ts', 'tests/trusted.frontend.ts']
});
