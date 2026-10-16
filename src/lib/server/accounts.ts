import { error, type RequestEvent } from '@sveltejs/kit';
import { and, count, desc, eq, gt, isNull, or, sql } from 'drizzle-orm';
import { hashPassword } from 'better-auth/crypto';
import { db } from './db/index.ts';
import {
	account,
	accountAudit,
	locationRecipient,
	locationSession,
	profile,
	session,
	user
} from './db/schema.ts';
import { requireAdmin } from './api.ts';
import { accountListInput, staffAccountInput } from './validation.ts';
import { emailConfigured } from './email.ts';
import type { z } from 'zod';

const summaryColumns = {
	id: user.id,
	name: user.name,
	email: user.email,
	role: user.role,
	banned: user.banned,
	emailVerified: user.emailVerified,
	createdAt: user.createdAt,
	deactivatedAt: profile.deactivatedAt
};

function summary(record: {
	id: string;
	name: string;
	email: string;
	role: string | null;
	banned: boolean | null;
	emailVerified: boolean;
	createdAt: Date;
	deactivatedAt?: Date | null;
}) {
	return {
		id: record.id,
		name: record.name,
		email: record.email,
		role: record.role ?? 'user',
		active: !record.banned && !record.deactivatedAt,
		emailVerified: record.emailVerified,
		createdAt: record.createdAt.toISOString()
	};
}

export function listAccounts(event: RequestEvent) {
	const actor = requireAdmin(event);
	const parsed = accountListInput.safeParse(Object.fromEntries(event.url.searchParams));
	if (!parsed.success) error(422, 'Invalid account search or page.');
	const input = parsed.data;
	// instr treats %, _ and quotes as literal search text. All values stay parameterized.
	const condition = and(
		input.search
			? sql`instr(lower(${user.name} || ' ' || ${user.email}), ${input.search.toLowerCase()}) > 0`
			: undefined,
		input.role === 'all'
			? undefined
			: input.role === 'user'
				? or(eq(user.role, 'user'), isNull(user.role))
				: eq(user.role, input.role)
	);
	const total = db.select({ value: count() }).from(user).where(condition).get()!.value;
	const pageSize = 20;
	const page = Math.min(input.page, Math.max(1, Math.ceil(total / pageSize)));
	const accounts = db
		.select(summaryColumns)
		.from(user)
		.leftJoin(profile, eq(profile.userId, user.id))
		.where(condition)
		.orderBy(desc(user.createdAt), user.id)
		.limit(pageSize)
		.offset((page - 1) * pageSize)
		.all()
		.map(summary);
	return {
		accounts,
		total,
		page,
		pageSize,
		search: input.search,
		role: input.role,
		currentUserId: actor.id,
		emailConfigured
	};
}

function checkCreationLimit(actorId: string) {
	const recent = db
		.select({ value: count() })
		.from(accountAudit)
		.where(
			and(
				eq(accountAudit.actorUserId, actorId),
				or(eq(accountAudit.action, 'dispatcher_created'), eq(accountAudit.action, 'admin_created')),
				gt(accountAudit.createdAt, new Date(Date.now() - 3600000))
			)
		)
		.get()!.value;
	if (recent >= 20) error(429, 'Account creation limit reached. Try again later.');
}

export async function createStaffAccount(
	event: RequestEvent,
	input: z.output<typeof staffAccountInput>
) {
	checkCreationLimit(requireAdmin(event).id);
	const password = await hashPassword(input.password);
	return db.transaction(
		(tx) => {
			const actor = requireAdmin(event);
			checkCreationLimit(actor.id);
			if (
				tx
					.select({ id: user.id })
					.from(user)
					.where(sql`lower(${user.email}) = ${input.email}`)
					.get()
			) {
				error(409, 'An account with this email already exists.');
			}
			const id = crypto.randomUUID();
			const now = new Date();
			const created = tx
				.insert(user)
				.values({
					id,
					name: input.name,
					email: input.email,
					role: input.role,
					emailVerified: false,
					createdAt: now,
					updatedAt: now
				})
				.returning()
				.get();
			tx.insert(account)
				.values({
					id: crypto.randomUUID(),
					userId: id,
					accountId: id,
					providerId: 'credential',
					password,
					createdAt: now,
					updatedAt: now
				})
				.run();
			tx.insert(accountAudit)
				.values({
					actorUserId: actor.id,
					targetUserId: id,
					action: input.role === 'admin' ? 'admin_created' : 'dispatcher_created'
				})
				.run();
			return summary(created);
		},
		{ behavior: 'immediate' }
	);
}

export function accountTarget(id: string | undefined) {
	if (!id || id.length > 128) error(400, 'Invalid account ID.');
	const target = db.select().from(user).where(eq(user.id, id)).get();
	if (!target) error(404, 'Account not found.');
	return target;
}

export function setAccountActive(event: RequestEvent, id: string | undefined, active: boolean) {
	return db.transaction(
		(tx) => {
			const actor = requireAdmin(event);
			const target = accountTarget(id);
			if (!active && target.role === 'admin' && target.emailVerified && !target.banned) {
				const admins = tx
					.select({ value: count() })
					.from(user)
					.where(
						and(
							eq(user.role, 'admin'),
							eq(user.emailVerified, true),
							or(eq(user.banned, false), isNull(user.banned))
						)
					)
					.get()!.value;
				if (admins <= 1) error(409, 'The last active administrator cannot be deactivated.');
			}
			if (target.id === actor.id) error(409, 'You cannot change your own account status.');
			const ownProfile = tx.select().from(profile).where(eq(profile.userId, target.id)).get();
			if (active === (!target.banned && !ownProfile?.deactivatedAt)) return { ok: true };
			const now = new Date();
			tx.update(user)
				.set({
					banned: !active,
					banReason: active ? null : 'Account deactivated by administrator',
					banExpires: null,
					updatedAt: now
				})
				.where(eq(user.id, target.id))
				.run();
			if (ownProfile) {
				tx.update(profile)
					.set({ deactivatedAt: active ? null : now, updatedAt: now })
					.where(eq(profile.id, ownProfile.id))
					.run();
				if (!active)
					tx.update(locationSession)
						.set({ cancelledAt: now })
						.where(
							and(
								eq(locationSession.ownerProfileId, ownProfile.id),
								isNull(locationSession.cancelledAt)
							)
						)
						.run();
			}
			// Old sessions never become valid again after reactivation.
			if (!active)
				tx.update(locationRecipient)
					.set({ revokedAt: now })
					.where(eq(locationRecipient.userId, target.id))
					.run();
			tx.delete(session).where(eq(session.userId, target.id)).run();
			tx.insert(accountAudit)
				.values({
					actorUserId: actor.id,
					targetUserId: target.id,
					action: active ? 'reactivated' : 'deactivated'
				})
				.run();
			return { ok: true };
		},
		{ behavior: 'immediate' }
	);
}
