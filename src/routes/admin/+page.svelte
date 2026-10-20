<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import {
		Users,
		Headset,
		ShieldCheck,
		Siren,
		Activity,
		CircleCheck,
		ArrowRight,
		RefreshCw
	} from '@lucide/svelte';
	import type { PageProps } from './$types';
	let { data }: PageProps = $props();
	type Summary = PageProps['data']['summary'];
	let latest = $state<Summary | null>(null);
	let busy = $state(false);
	let refreshError = $state('');
	let disposed = true;
	let controller: AbortController | undefined;
	const summary = $derived(latest ?? data.summary);
	const cards = $derived([
		{ label: 'Users', count: summary.users, icon: Users, note: 'User accounts' },
		{
			label: 'Dispatchers',
			count: summary.dispatchers,
			icon: Headset,
			note: 'Dispatcher accounts'
		},
		{ label: 'Administrators', count: summary.admins, icon: ShieldCheck, note: 'Admin accounts' },
		{ label: 'Waiting SOS', count: summary.unassigned, icon: Siren, note: 'Not assigned' },
		{
			label: 'Being handled',
			count: summary.inProgress + summary.onRoute,
			icon: Activity,
			note: 'In progress or on route'
		},
		{ label: 'Resolved', count: summary.resolved, icon: CircleCheck, note: 'Completed incidents' }
	]);
	const statuses = $derived([
		{ label: 'Not assigned', count: summary.unassigned },
		{ label: 'In progress', count: summary.inProgress },
		{ label: 'On route', count: summary.onRoute },
		{ label: 'Resolved', count: summary.resolved }
	]);
	const updated = $derived(
		new Date(summary.updatedAt).toLocaleString('en-PH', {
			timeZone: 'Asia/Manila',
			month: 'short',
			day: 'numeric',
			year: 'numeric',
			hour: 'numeric',
			minute: '2-digit',
			second: '2-digit'
		})
	);
	async function refreshDashboard() {
		if (disposed || busy || document.visibilityState !== 'visible') return;
		busy = true;
		const request = new AbortController();
		controller = request;
		try {
			const response = await fetch('/api/admin/dashboard', {
				signal: request.signal,
				cache: 'no-store'
			});
			if (!response.ok) throw new Error('Dashboard refresh failed');
			const result: Summary = await response.json();
			if (disposed || request.signal.aborted) return;
			latest = result;
			refreshError = '';
		} catch {
			if (!disposed && !request.signal.aborted)
				refreshError = 'Unable to update. Showing the last available counts.';
		} finally {
			if (!disposed) busy = false;
			if (controller === request) controller = undefined;
		}
	}
	onMount(() => {
		disposed = false;
		const interval = window.setInterval(() => {
			void refreshDashboard();
		}, 15000);
		const onVisible = () => {
			void refreshDashboard();
		};
		document.addEventListener('visibilitychange', onVisible);
		return () => {
			disposed = true;
			controller?.abort();
			window.clearInterval(interval);
			document.removeEventListener('visibilitychange', onVisible);
		};
	});
</script>

<svelte:head><title>Admin dashboard | HandLink</title></svelte:head>

<div class="admin-dashboard">
	<header class="dashboard-heading">
		<div>
			<p class="eyebrow">ADMINISTRATION</p>
			<h1 class="page-heading">Dashboard</h1>
			<p class="muted">Accounts and SOS activity at a glance.</p>
		</div>
		<button type="button" class="btn btn-outline" disabled={busy} onclick={refreshDashboard}
			><RefreshCw size={20} aria-hidden="true" />{busy ? 'Updating...' : 'Refresh'}</button
		>
	</header>
	<p class="update-note">
		Updated <time datetime={new Date(summary.updatedAt).toISOString()}>{updated}</time> PHT Updates every
		15 seconds while this page is visible.
	</p>
	{#if refreshError}<p class="refresh-error" role="alert">{refreshError}</p>{/if}
	<section class="summary-grid" aria-label="System summary">
		{#each cards as card (card.label)}
			<article class="summary-card">
				<div class="card-heading">
					<h2>{card.label}</h2>
					<card.icon size={24} aria-hidden="true" />
				</div>
				<p class="count">{card.count.toLocaleString('en-PH')}</p>
				<p class="card-note">{card.note}</p>
			</article>
		{/each}
	</section>
	<div class="dashboard-grid">
		<section class="dashboard-panel" aria-labelledby="status-heading">
			<h2 id="status-heading" class="section-heading">Incident status</h2>
			<p class="muted">Counts across all saved SOS incidents.</p>
			<table>
				<caption class="sr-only">Number of incidents by current status</caption><thead
					><tr><th scope="col">Status</th><th scope="col">Incidents</th></tr></thead
				><tbody
					>{#each statuses as status (status.label)}<tr
							><th scope="row">{status.label}</th><td>{status.count.toLocaleString('en-PH')}</td
							></tr
						>{/each}</tbody
				>
			</table>
		</section>
		<section class="dashboard-panel" aria-labelledby="actions-heading">
			<h2 id="actions-heading" class="section-heading">Quick access</h2>
			<div class="quick-links">
				<a href={resolve('/admin/alerts')}
					><Siren size={24} aria-hidden="true" /><span
						><strong>SOS alerts</strong><small>Review the live queue</small></span
					><ArrowRight size={20} aria-hidden="true" /></a
				>
				<a href={resolve('/admin/accounts')}
					><Users size={24} aria-hidden="true" /><span
						><strong>Manage accounts</strong><small
							>{summary.activeAccounts.toLocaleString('en-PH')} active accounts</small
						></span
					><ArrowRight size={20} aria-hidden="true" /></a
				>
				<a href={resolve('/admin/reports')}
					><CircleCheck size={24} aria-hidden="true" /><span
						><strong>Incident reports</strong><small>Review saved reports</small></span
					><ArrowRight size={20} aria-hidden="true" /></a
				>
			</div>
		</section>
	</div>
</div>

<style>
	.admin-dashboard {
		display: grid;
		gap: 24px;
		color: var(--app-text);
	}
	.dashboard-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 20px;
	}
	.dashboard-heading h1 {
		margin: 6px 0 10px;
		font-weight: 750;
	}
	.update-note {
		color: var(--app-muted);
		font-size: 14px;
		line-height: 1.7;
	}
	.refresh-error {
		padding: 16px;
		border: 1px solid var(--app-danger);
		color: var(--app-danger);
		border-radius: 10px;
	}
	.summary-grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 18px;
	}
	.summary-card,
	.dashboard-panel {
		min-width: 0;
		padding: 24px;
		border: 1px solid var(--app-border);
		border-radius: 16px;
		background: var(--app-surface);
	}
	.card-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}
	.card-heading h2 {
		font-size: 16px;
		font-weight: 650;
	}
	.card-heading :global(svg) {
		color: var(--app-accent);
		flex-shrink: 0;
	}
	.count {
		margin: 14px 0 2px;
		font-size: clamp(2rem, 4vw, 2.6rem);
		font-weight: 750;
		line-height: 1.2;
		overflow-wrap: anywhere;
	}
	.card-note {
		color: var(--app-muted);
		font-size: 14px;
	}
	.dashboard-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 20px;
		align-items: start;
	}
	.dashboard-panel > .muted {
		margin-top: 8px;
	}
	table {
		width: 100%;
		margin-top: 20px;
		border-collapse: collapse;
	}
	th,
	td {
		padding: 15px 8px;
		border-bottom: 1px solid var(--app-border);
		text-align: left;
		font-size: 16px;
	}
	thead th {
		color: var(--app-muted);
		font-size: 14px;
	}
	tbody th {
		font-weight: 500;
	}
	td,
	thead th:last-child {
		text-align: right;
	}
	td {
		font-variant-numeric: tabular-nums;
		font-weight: 650;
	}
	.quick-links {
		display: grid;
		gap: 12px;
		margin-top: 20px;
	}
	.quick-links a {
		display: flex;
		gap: 14px;
		align-items: center;
		min-height: 72px;
		padding: 16px;
		border: 1px solid var(--app-border);
		border-radius: 10px;
		text-decoration: none;
		color: var(--app-text);
	}
	.quick-links a:hover {
		background: var(--app-surface-alt);
	}
	.quick-links a > span {
		flex: 1;
		min-width: 0;
	}
	.quick-links strong,
	.quick-links small {
		display: block;
	}
	.quick-links small {
		color: var(--app-muted);
		margin-top: 4px;
		font-size: 14px;
	}
	.quick-links :global(svg) {
		flex-shrink: 0;
	}
	@media (max-width: 1100px) {
		.summary-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.dashboard-grid {
			grid-template-columns: 1fr;
		}
	}
	@media (max-width: 420px) {
		.summary-grid {
			grid-template-columns: 1fr;
		}
		.summary-card,
		.dashboard-panel {
			padding: 20px;
		}
	}
</style>
