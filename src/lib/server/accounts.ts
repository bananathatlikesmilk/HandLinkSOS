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
	staffLgu,
	lgu,
	session,
	user
} from './db/schema.ts';
import { requireAdmin } from './api.ts';
import { staffScope } from './lgu-scope.ts';
import { requireLgu } from './lgus.ts';
import { accountListInput, staffAccountInput } from './validation.ts';
import { emailConfigured } from './email.ts';
import type { z } from 'zod';
import { PROVINCIAL_LGU_ID } from '../lgu.ts';

const summaryColumns = {
	lguId: staffLgu.lguId,
	lguName: lgu.name,
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
	lguId?: string | null;
	lguName?: string | null;
}) {
	return {
		lguId: record.lguId ?? (record.role === 'dispatcher' ? 'legacy' : null),
		lguName: record.lguName ?? (record.role === 'dispatcher' ? 'Existing LGU' : null),
		centralAdmin: record.role === 'admin' && !record.lguId,
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
		actor.centralAdmin ? undefined : eq(staffLgu.lguId, actor.lguId!),
		input.search
			? sql`instr(lower(${user.name} || ' ' || ${user.email}), ${input.search.toLowerCase()}) > 0`
			: undefined,
		input.role === 'all'
			? undefined
			: input.role === 'user'
				? or(eq(user.role, 'user'), isNull(user.role))
				: eq(user.role, input.role)
	);
	const total = db
		.select({ value: count() })
		.from(user)
		.leftJoin(staffLgu, eq(staffLgu.userId, user.id))
		.where(condition)
		.get()!.value;
	const pageSize = 20;
	const page = Math.min(input.page, Math.max(1, Math.ceil(total / pageSize)));
	const accounts = db
		.select(summaryColumns)
		.from(user)
		.leftJoin(profile, eq(profile.userId, user.id))
		.leftJoin(staffLgu, eq(staffLgu.userId, user.id))
		.leftJoin(lgu, eq(lgu.id, staffLgu.lguId))
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
		centralAdmin: actor.centralAdmin,
		lgus: db
			.select({ id: lgu.id, name: lgu.name, active: lgu.active })
			.from(lgu)
			.where(actor.centralAdmin ? undefined : eq(lgu.id, actor.lguId!))
			.orderBy(lgu.name)
			.all(),
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
			const selectedLguId = input.lguId ?? actor.lguId ?? 'legacy';
			if (!actor.centralAdmin && selectedLguId !== actor.lguId)
				error(403, 'You can create staff only for your LGU.');
			const selectedLgu = requireLgu(selectedLguId);
			if (
				selectedLguId === PROVINCIAL_LGU_ID &&
				(!actor.centralAdmin || input.role !== 'dispatcher')
			)
				error(
					403,
					'Only central Admins can create provincial dispatchers. Choose a municipal LGU for local staff.'
				);
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
			tx.insert(staffLgu).values({ userId: id, lguId: selectedLguId }).run();
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
			return summary({ ...created, lguId: selectedLguId, lguName: selectedLgu.name });
		},
		{ behavior: 'immediate' }
	);
}

export function accountTarget(id: string | undefined, event?: RequestEvent) {
	if (!id || id.length > 128) error(400, 'Invalid account ID.');
	const target = db.select().from(user).where(eq(user.id, id)).get();
	if (!target) error(404, 'Account not found.');
	if (event) {
		const actor = requireAdmin(event);
		const targetScope = staffScope(target);
		if (
			!actor.centralAdmin &&
			(!['admin', 'dispatcher'].includes(target.role ?? '') ||
				targetScope.centralAdmin ||
				targetScope.lguId !== actor.lguId)
		)
			error(404, 'Account not found.');
	}
	return target;
}

export function setAccountActive(event: RequestEvent, id: string | undefined, active: boolean) {
	return db.transaction(
		(tx) => {
			const actor = requireAdmin(event);
			const target = accountTarget(id, event);
			if (
				!active &&
				target.role === 'admin' &&
				target.emailVerified &&
				!target.banned &&
				staffScope(target).centralAdmin
			) {
				const admins = tx
					.select({ value: count() })
					.from(user)
					.leftJoin(staffLgu, eq(staffLgu.userId, user.id))
					.where(
						and(
							isNull(staffLgu.userId),
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
