import type { APIRequestContext } from '@playwright/test';

// Preview has one shared client-IP bucket. Respect its real login limiter in tests.
export async function signInWithRateLimit(
	request: APIRequestContext,
	email: string,
	password: string
) {
	for (let attempt = 0; ; attempt++) {
		const response = await request.post('/api/auth/sign-in/email', {
			headers: { Origin: 'http://127.0.0.1:4174' },
			data: { email, password }
		});
		if (response.status() !== 429 || attempt >= 2) return response;
		const seconds = Number(response.headers()['retry-after']);
		await new Promise((resolve) =>
			setTimeout(resolve, (Number.isFinite(seconds) && seconds > 0 ? seconds : 10) * 1000 + 100)
		);
	}
}
