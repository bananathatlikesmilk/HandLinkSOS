import { expect, test } from '@playwright/test';

test('profile API rejects anonymous reads and writes', async ({ request }) => {
	const read = await request.get('/api/profile');
	expect(read.status()).toBe(401);
	expect(await read.text()).not.toContain('medical');
	const write = await request.put('/api/profile', {
		data: { userId: 'another-user', role: 'admin' }
	});
	expect(write.status()).toBe(401);
});
