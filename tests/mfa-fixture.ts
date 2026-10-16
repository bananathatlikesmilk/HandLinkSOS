import { createHmac } from 'node:crypto';
import { expect, type APIRequestContext } from '@playwright/test';

// Independent RFC 6238 test authenticator. Secrets belong only to isolated fixtures.
export function totp(uri: string) {
	const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
	const secret = new URL(uri).searchParams.get('secret')!;
	let bits = '';
	for (const char of secret.toUpperCase().replace(/=+$/, '')) {
		bits += alphabet.indexOf(char).toString(2).padStart(5, '0');
	}
	const key = Buffer.from(
		Array.from({ length: Math.floor(bits.length / 8) }, (_, i) =>
			parseInt(bits.slice(i * 8, i * 8 + 8), 2)
		)
	);
	const counter = Buffer.alloc(8);
	counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
	const hash = createHmac('sha1', key).update(counter).digest();
	const offset = hash[hash.length - 1] & 15;
	return String((hash.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0');
}

export async function enrollStaffMfa(request: APIRequestContext, password: string) {
	const current = await (await request.get('/api/auth/get-session')).json();
	if (!['admin', 'dispatcher'].includes(current?.user?.role)) return null;
	const headers = { Origin: 'http://127.0.0.1:4174' };
	async function send(path: string, data: object) {
		for (let attempt = 0; ; attempt++) {
			const response = await request.post(`/api/auth/two-factor/${path}`, { headers, data });
			if (response.status() !== 429 || attempt >= 2) return response;
			const seconds = Number(response.headers()['retry-after']);
			await new Promise((resolve) =>
				setTimeout(resolve, (seconds > 0 && Number.isFinite(seconds) ? seconds : 10) * 1000 + 100)
			);
		}
	}
	const enabled = await send('enable', { password });
	expect(enabled.ok()).toBe(true);
	const setup = (await enabled.json()) as { totpURI: string; backupCodes: string[] };
	const verified = await send('verify-totp', { code: totp(setup.totpURI), trustDevice: false });
	expect(verified.ok()).toBe(true);
	return setup;
}
