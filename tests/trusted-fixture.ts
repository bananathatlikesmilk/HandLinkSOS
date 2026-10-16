import { createHmac, randomInt } from 'node:crypto';
import { expect, type APIRequestContext } from '@playwright/test';
import { database, headers } from './incident-fixture';

export function challenge(
	userId: string,
	options: { expired?: boolean; attempts?: number; purpose?: string } = {}
) {
	const requestId = crypto.randomUUID();
	const code = String(randomInt(0, 1000000)).padStart(6, '0');
	const secret = 'isolated-test-secret-only-012345678901234567890123456789';
	const codeHash = createHmac('sha256', secret)
		.update(`qr_access:${userId}:${requestId}:${code}`)
		.digest('hex');
	const now = Date.now();
	const db = database();
	try {
		db.prepare(
			'INSERT INTO verification_request (id,user_id,purpose,code_hash,attempts,created_at,expires_at) VALUES (?,?,?,?,?,?,?)'
		).run(
			requestId,
			userId,
			options.purpose ?? 'qr_access',
			codeHash,
			options.attempts ?? 0,
			now - 10000,
			options.expired ? now - 1000 : now + 300000
		);
	} finally {
		db.close();
	}
	return { requestId, code, expiresAt: new Date(now + 300000).toISOString() };
}
export async function invitation(request: APIRequestContext, userId: string) {
	const input = challenge(userId);
	const response = await request.post('/api/trusted/qr', {
		headers,
		data: { requestId: input.requestId, code: input.code }
	});
	expect(response.status(), await response.text()).toBe(201);
	return (await response.json()) as { invitationId: string; token: string; expiresAt: string };
}
