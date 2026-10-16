import { defineConfig } from '@playwright/test';
import base from './playwright.database.config';
export default defineConfig({ ...base, testMatch: 'tests/account.frontend.ts' });
