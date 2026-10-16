import { defineConfig } from '@playwright/test';
import base from './playwright.recovery.config';

export default defineConfig({ ...base, testMatch: 'tests/mfa.api.ts' });
