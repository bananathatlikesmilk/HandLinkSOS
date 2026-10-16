import { db } from '#lib/server/db/index.ts';
import { BETTER_AUTH_SECRET, ORIGIN } from '$app/env/private';
import { getRequestEvent } from '$app/server';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { betterAuth } from 'better-auth/minimal';
import { admin } from 'better-auth/plugins/admin';
import { twoFactor } from 'better-auth/plugins/two-factor';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { emailOTP } from 'better-auth/plugins/email-otp';
import { createHmac } from 'node:crypto';
import { emailConfigured, sendCode } from './email.ts';
import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api';
import { and, eq, gt, ne } from 'drizzle-orm';
import { session as authSession, user as authUser } from './db/schema.ts';
import { hasStaffMfa } from './staff-mfa.ts';
import { mfaPasswordInput, mfaSetupInput, mfaTotpInput, mfaBackupInput } from './validation.ts';

const adminPlugin = admin({ defaultRole: 'user' });

export const auth = betterAuth({
	baseURL: ORIGIN,
	secret: BETTER_AUTH_SECRET,
	// Account writes belong to our validated, audited admin API. Keep ban enforcement,
	// but do not expose parallel role, delete, impersonation, or user-update endpoints.
	disabledPaths: Object.values(adminPlugin.endpoints).map((endpoint) => endpoint.path),
	database: drizzleAdapter(db, { provider: 'sqlite' }),
	session: {
		additionalFields: { mfaVerifiedAt: { type: 'date', input: false, returned: false } }
	},
	databaseHooks: {
		session: {
			create: {
				before: async (session, ctx) => {
					const identity = db.select().from(authUser).where(eq(authUser.id, session.userId)).get();
					if (
						identity &&
						['admin', 'dispatcher'].includes(identity.role ?? '') &&
						(identity.banned || !identity.emailVerified)
					) {
						throw new APIError('FORBIDDEN', { message: 'Staff account is not available.' });
					}
					// Only the native factor-verification handlers create an MFA-proven session.
					// Password sign-in and session rotation cannot copy or submit this proof.
					const verified = ['/two-factor/verify-totp', '/two-factor/verify-backup-code'].includes(
						ctx?.path ?? ''
					);
					return { data: { ...session, mfaVerifiedAt: verified ? new Date() : null } };
				}
			}
		}
	},
	hooks: {
		before: createAuthMiddleware(async (ctx) => {
			const schema =
				ctx.path === '/two-factor/enable'
					? mfaSetupInput
					: ctx.path === '/two-factor/verify-totp'
						? mfaTotpInput
						: ctx.path === '/two-factor/verify-backup-code'
							? mfaBackupInput
							: [
										'/two-factor/disable',
										'/two-factor/get-totp-uri',
										'/two-factor/generate-backup-codes'
								  ].includes(ctx.path)
								? mfaPasswordInput
								: null;
			if (!schema) return;
			if (!schema.safeParse(ctx.body).success)
				throw new APIError('BAD_REQUEST', { message: 'Invalid MFA fields or format.' });
			const current = await getSessionFromCtx(ctx);
			if (!current) return; // Native handlers validate the signed, short-lived login challenge.
			const identity = db.select().from(authUser).where(eq(authUser.id, current.user.id)).get();
			if (!identity || !['admin', 'dispatcher'].includes(identity.role ?? '')) return;
			const active = db
				.select({ id: authSession.id })
				.from(authSession)
				.where(
					and(
						eq(authSession.id, current.session.id),
						eq(authSession.userId, identity.id),
						gt(authSession.expiresAt, new Date())
					)
				)
				.get();
			if (!active || identity.banned || !identity.emailVerified)
				throw new APIError('FORBIDDEN', { message: 'Staff account is not available.' });
			if (
				[
					'/two-factor/disable',
					'/two-factor/get-totp-uri',
					'/two-factor/generate-backup-codes'
				].includes(ctx.path) &&
				!hasStaffMfa(identity.id, current.session.id)
			) {
				throw new APIError('FORBIDDEN', {
					message: 'Sign in with MFA before changing security settings.'
				});
			}
		}),
		after: createAuthMiddleware(async (ctx) => {
			if (!['/two-factor/disable', '/two-factor/verify-totp'].includes(ctx.path)) return;
			const fresh = ctx.context.newSession;
			if (!fresh || !['admin', 'dispatcher'].includes(String(fresh.user.role ?? ''))) return;
			if (ctx.path === '/two-factor/verify-totp' && !ctx.context.session?.session) return;
			// Enrollment and authenticator replacement retire other pre-existing sessions.
			db.delete(authSession)
				.where(and(eq(authSession.userId, fresh.user.id), ne(authSession.id, fresh.session.id)))
				.run();
		})
	},
	emailAndPassword: {
		enabled: true,
		requireEmailVerification: true,
		minPasswordLength: 12,
		maxPasswordLength: 128,
		revokeSessionsOnPasswordReset: true
	},
	user: {
		additionalFields: {
			role: { type: 'string', defaultValue: 'user', input: false }
		}
	},
	plugins: [
		...(emailConfigured
			? [
					emailOTP({
						sendVerificationOTP: async ({ email, otp, type }) => sendCode(email, otp, type),
						sendVerificationOnSignUp: true,
						overrideDefaultEmailVerification: true,
						disableSignUp: true,
						expiresIn: 300,
						allowedAttempts: 5,
						storeOTP: {
							hash: async (otp) =>
								createHmac('sha256', BETTER_AUTH_SECRET).update(otp).digest('hex')
						},
						rateLimit: { window: 60, max: 3 }
					})
				]
			: []),
		adminPlugin,
		twoFactor({ issuer: 'HandLink', backupCodeOptions: { storeBackupCodes: 'encrypted' } }),
		sveltekitCookies(getRequestEvent) // make sure this is the last plugin in the array
	]
});
