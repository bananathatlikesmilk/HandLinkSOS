import assert from 'node:assert/strict';
import { test } from 'node:test';
import { variables } from '../src/env.ts';

test('SMTP settings are declared server-only and remain optional before configuration', async () => {
	for (const key of ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM']) {
		const variable = variables[key];
		assert.ok(variable, `${key} must be declared so SvelteKit can expose it to server modules`);
		assert.notEqual(variable.public, true, `${key} must never be public`);
		const validate = variable.schema['~standard'].validate;
		assert.deepEqual(await validate(undefined), { value: undefined });
		assert.deepEqual(await validate('configured-test-value'), { value: 'configured-test-value' });
	}
});
