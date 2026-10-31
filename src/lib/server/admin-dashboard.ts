import type { RequestEvent } from '@sveltejs/kit';
import { count, eq, isNull, or, and, sql } from 'drizzle-orm';
import { db } from './db/index.ts';
import { user, incident, incidentLgu, staffLgu } from './db/schema.ts';
import { routingLguId } from './lgu-scope.ts';
import { requireAdmin } from './api.ts';

export function adminDashboard(event: RequestEvent) {
	return db.transaction(() => {
		const actor = requireAdmin(event);
		const accountScope = actor.centralAdmin ? undefined : eq(staffLgu.lguId, actor.lguId!);
		const incidentScope = actor.centralAdmin ? undefined : eq(routingLguId, actor.lguId!);
		const accounts = db
			.select({ role: user.role, total: count() })
			.from(user)
			.leftJoin(staffLgu, eq(staffLgu.userId, user.id))
			.where(accountScope)
			.groupBy(user.role)
			.all();
		const stages = db
			.select({ status: incident.status, total: count() })
			.from(incident)
			.leftJoin(incidentLgu, eq(incidentLgu.incidentId, incident.id))
			.where(incidentScope)
			.groupBy(incident.status)
			.all();
		const byRole = (role: string) =>
			accounts
				.filter((row) => (row.role ?? 'user') === role)
				.reduce((sum, row) => sum + row.total, 0);
		const byStatus = (status: string) => stages.find((row) => row.status === status)?.total ?? 0;
		const activeAccounts = db
			.select({ total: count() })
			.from(user)
			.leftJoin(staffLgu, eq(staffLgu.userId, user.id))
			.where(
				and(
					accountScope,
					eq(user.emailVerified, true),
					or(eq(user.banned, false), isNull(user.banned))
				)
			)
			.get()!.total;
		return {
			users: actor.centralAdmin
				? byRole('user')
				: db
						.select({ n: sql<number>`count(distinct ${incident.personProfileId})` })
						.from(incident)
						.leftJoin(incidentLgu, eq(incidentLgu.incidentId, incident.id))
						.where(incidentScope)
						.get()!.n,
			centralAdmin: actor.centralAdmin,
			scopeName: actor.centralAdmin ? 'All LGUs' : actor.lguName,
			dispatchers: byRole('dispatcher'),
			admins: byRole('admin'),
			activeAccounts,
			unassigned: byStatus('Not assigned'),
			inProgress: byStatus('In progress'),
			onRoute: byStatus('On route'),
			resolved: byStatus('Resolved'),
			updatedAt: new Date().toISOString()
		};
	});
}
