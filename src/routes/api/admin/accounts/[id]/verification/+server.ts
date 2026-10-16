import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { privateJson, readInput, requireAdmin } from '#lib/server/api.ts';
import { accountTarget } from '#lib/server/accounts.ts';
import { emailConfigured } from '#lib/server/email.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	requireAdmin(event);
	await readInput(event, z.strictObject({}));
	requireAdmin(event);
	const target = accountTarget(event.params.id);
	if (target.banned || target.emailVerified)
		error(409, 'This account does not need a verification email.');
	if (!emailConfigured) error(503, 'Email delivery is not configured. The account remains saved.');
	// Use the existing OTP endpoint so its expiry, attempt limits and rate limits still apply.
	const response = await event.fetch('/api/auth/email-otp/send-verification-otp', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Origin: event.url.origin },
		body: JSON.stringify({ email: target.email, type: 'email-verification' })
	});
	if (!response.ok)
		error(
			response.status === 429 ? 429 : 502,
			response.status === 429
				? 'Too many email requests. Try again later.'
				: 'Email could not be sent. The account remains saved; try again.'
		);
	return privateJson({ ok: true });
};
