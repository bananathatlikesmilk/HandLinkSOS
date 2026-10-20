import type { RequestEvent } from '@sveltejs/kit';
import { count, eq, isNull, or, and } from 'drizzle-orm';
import { db } from './db/index.ts';
import { user, incident } from './db/schema.ts';
import { requireAdmin } from './api.ts';

export function adminDashboard(event: RequestEvent) {
	return db.transaction(() => {
		requireAdmin(event);
		const accounts = db
			.select({ role: user.role, total: count() })
			.from(user)
			.groupBy(user.role)
			.all();
		const stages = db
			.select({ status: incident.status, total: count() })
			.from(incident)
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
			.where(and(eq(user.emailVerified, true), or(eq(user.banned, false), isNull(user.banned))))
			.get()!.total;
		return {
			users: byRole('user'),
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
