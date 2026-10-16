<script lang="ts">
	import { onMount } from 'svelte';
	import IncidentCancellationReview from './IncidentCancellationReview.svelte';
	import AiReportSummary from './AiReportSummary.svelte';
	import { page as route } from '$app/state';
	import { resolve } from '$app/paths';
	import { Archive, Check, FileText, RefreshCw, Search } from '@lucide/svelte';
	import type { IncidentReport, IncidentSummary } from '#lib/incidents.ts';
	let incidents = $state<IncidentSummary[]>([]);
	let selected = $state<IncidentReport | null>(null);
	let selectedId = $state('');
	let currentUserId = $state('');
	let search = $state('');
	let appliedSearch = '';
	let filter = $state('All');
	let page = $state(1);
	let total = $state(0);
	let pageSize = $state(20);
	let loading = $state(true);
	let detailLoading = $state(false);
	let busy = $state(false);
	let queueError = $state('');
	let detailError = $state('');
	let actionError = $state('');
	let notice = $state('');
	let queueController: AbortController | undefined;
	let detailController: AbortController | undefined;
	let disposed = false;
	const endpoint = resolve('/api/staff/incidents');
	const totalPages = $derived(Math.max(1, Math.ceil(total / pageSize)));
	const ownIncident = $derived(
		route.data.account?.role === 'dispatcher' &&
			currentUserId === route.data.account.id &&
			!!selected &&
			selected.incident.dispatcherUserId === currentUserId
	);
	function date(value: string | null) {
		return value ? new Date(value).toLocaleString() : 'Not yet';
	}
	function duration(start: string, end: string | null) {
		if (!end) return 'Ongoing';
		const seconds = Math.max(
			0,
			Math.floor((new Date(end).getTime() - new Date(start).getTime()) / 1000)
		);
		return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m ${seconds % 60}s`;
	}
	async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
		const response = await fetch(url, { cache: 'no-store', ...options });
		const result = await response.json().catch(() => null);
		if (!response.ok) {
			if (response.status === 401 || response.status === 403) {
				incidents = [];
				selected = null;
			}
			throw new Error(result?.message ?? 'Request failed. Refresh or sign in again.');
		}
		if (!result) throw new Error('Invalid server response. Try refreshing this page.');
		return result as T;
	}
	async function loadDetail(id: string, poll = false) {
		detailController?.abort();
		const controller = new AbortController();
		detailController = controller;
		if (!poll) detailLoading = true;
		detailError = '';
		try {
			const result = await request<IncidentReport>(resolve('/api/staff/reports/[id]', { id }), {
				signal: controller.signal
			});
			if (!disposed && !controller.signal.aborted && selectedId === id) selected = result;
		} catch (cause) {
			if (!disposed && !controller.signal.aborted && selectedId === id) {
				selected = null;
				detailError = cause instanceof Error ? cause.message : 'Unable to load report.';
			}
		} finally {
			if (!disposed && detailController === controller) detailLoading = false;
		}
	}
	function selectReport(id: string) {
		if (busy) return;
		selectedId = id;
		selected = null;
		actionError = '';
		notice = '';
		void loadDetail(id);
	}
	async function loadQueue(nextPage = page, keepSelection = false, poll = false) {
		if (busy || (poll && (queueController || detailLoading))) return;
		queueController?.abort();
		detailController?.abort();
		const controller = new AbortController();
		queueController = controller;
		if (!poll) loading = true;
		queueError = '';
		detailError = '';
		if (!keepSelection) {
			selectedId = '';
			selected = null;
		}
		try {
			const query = new URLSearchParams({
				view: 'reports',
				search: poll ? appliedSearch : (appliedSearch = search.trim()),
				status: filter,
				page: String(nextPage)
			});
			const result = await request<{
				incidents: IncidentSummary[];
				total: number;
				page: number;
				pageSize: number;
				currentUserId: string;
			}>(`${endpoint}?${query}`, { signal: controller.signal });
			if (disposed || controller.signal.aborted) return;
			incidents = result.incidents;
			total = result.total;
			page = result.page;
			pageSize = result.pageSize;
			currentUserId = result.currentUserId;
			if (keepSelection && selectedId) await loadDetail(selectedId, true);
			else if (incidents.length) selectReport(incidents[0].id);
		} catch (cause) {
			if (!disposed && !controller.signal.aborted) {
				incidents = [];
				selected = null;
				queueError = cause instanceof Error ? cause.message : 'Unable to load reports.';
			}
		} finally {
			if (queueController === controller) {
				queueController = undefined;
				if (!disposed) loading = false;
			}
		}
	}
	async function changeStatus(status: 'On route' | 'Resolved') {
		if (busy || !selected || !ownIncident) return;
		busy = true;
		actionError = '';
		notice = '';
		queueController?.abort();
		detailController?.abort();
		try {
			await request(`${endpoint}/${encodeURIComponent(selected.incident.id)}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ status })
			});
			if (!disposed) notice = `Incident marked ${status.toLowerCase()}.`;
		} catch (cause) {
			if (!disposed)
				actionError =
					cause instanceof Error
						? cause.message
						: 'Unable to update status. Refresh before retrying.';
		} finally {
			busy = false;
			if (!disposed) await loadQueue(page, true);
		}
	}
	function cancellationBusy(value: boolean) {
		busy = value;
		if (value) {
			queueController?.abort();
			detailController?.abort();
		}
	}
	onMount(() => {
		void loadQueue();
		const refresh = () => {
			if (document.visibilityState === 'visible') void loadQueue(page, true, true);
		};
		const interval = setInterval(refresh, 5000);
		document.addEventListener('visibilitychange', refresh);
		return () => {
			disposed = true;
			clearInterval(interval);
			document.removeEventListener('visibilitychange', refresh);
			queueController?.abort();
			detailController?.abort();
		};
	});
</script>

<svelte:head><title>Incident reports · HandLink</title></svelte:head>
<div class="reports-workspace space-y-6">
	<header class="flex flex-wrap items-start justify-between gap-4">
		<div>
			<p class="records-cue"><FileText size={18} aria-hidden="true" /> CASE RECORDS</p>
			<h1 class="page-heading mt-2">Incident reports</h1>
			<p class="muted mt-2">
				{route.data.account?.role === 'admin'
					? 'Read-only oversight of confirmed cases, saved notes, response times and AI summaries.'
					: 'Confirmed cases, saved notes, response times and AI summaries.'}
			</p>
		</div>
		<button class="btn btn-outline" disabled={loading || busy} onclick={() => loadQueue(page, true)}
			><RefreshCw size={17} /> Refresh reports</button
		>
	</header>
	{#if notice}<p class="alert" role="status"><Check size={17} />{notice}</p>{/if}
	{#if actionError}<p class="alert alert-error" role="alert">{actionError}</p>{/if}
	<div class="report-grid">
		<section class="panel report-archive" aria-busy={loading}>
			<div class="archive-heading">
				<Archive size={21} aria-hidden="true" />
				<h2 class="section-heading">Report archive</h2>
			</div>
			<p class="archive-copy">Select a case to read its saved record.</p>
			<form
				class="mt-5 space-y-3"
				onsubmit={(event) => {
					event.preventDefault();
					void loadQueue(1);
				}}
			>
				<label class="input w-full"
					><Search size={17} /><input
						aria-label="Search reports"
						placeholder="Search name or incident reference"
						maxlength="100"
						bind:value={search}
						disabled={busy}
					/></label
				>
				<label class="field-label"
					>Status<select
						class="select w-full"
						bind:value={filter}
						disabled={busy}
						onchange={(event) => {
							filter = event.currentTarget.value;
							void loadQueue(1);
						}}
						><option>All</option><option>In progress</option><option>On route</option><option
							>Resolved</option
						></select
					></label
				>
				<button class="btn w-full btn-outline" disabled={busy || loading}>Search reports</button>
			</form>
			<div class="report-choices mt-5">
				{#if queueError}<p role="alert">{queueError}</p>
				{:else if loading}<p role="status">Loading reports…</p>
				{:else}
					{#each incidents as record (record.id)}
						<button
							class="report-choice"
							class:active={selectedId === record.id}
							aria-pressed={selectedId === record.id}
							disabled={busy}
							onclick={() => selectReport(record.id)}
							><span class="record-icon"><FileText size={20} aria-hidden="true" /></span><span
								><strong>{record.reference}</strong><small>{record.personName}</small><small
									>{record.status} | {date(record.startedAt)}</small
								>{#if record.cancellationPending}<small>Cancellation requested</small>{/if}</span
							></button
						>
					{:else}<div class="empty-report">
							<Search size={23} />
							<p>No reports match your search.</p>
						</div>{/each}
				{/if}
			</div>
			<p class="muted mt-6 text-xs">
				{total} report{total === 1 ? '' : 's'} · Page {page} of {totalPages}
			</p>
			<div class="mt-3 flex justify-between gap-2">
				<button
					class="btn btn-outline btn-sm"
					disabled={busy || loading || page <= 1}
					onclick={() => loadQueue(page - 1)}>Previous</button
				><button
					class="btn btn-outline btn-sm"
					disabled={busy || loading || page >= totalPages}
					onclick={() => loadQueue(page + 1)}>Next</button
				>
			</div>
		</section>
		<article class="panel report-document" aria-busy={detailLoading}>
			{#if detailError}<p role="alert">{detailError}</p>
				<button class="btn mt-4 btn-outline" disabled={busy} onclick={() => loadDetail(selectedId)}
					>Retry report</button
				>
			{:else if detailLoading}<p role="status">Loading report…</p>
			{:else if selected}
				<div class="document-heading">
					<div>
						<p class="document-label"><FileText size={19} aria-hidden="true" /> INCIDENT REPORT</p>
						<h2 class="mt-2 text-2xl font-semibold tracking-tight break-all">
							{selected.incident.reference}
						</h2>
						<p class="muted mt-1 text-sm">{date(selected.incident.startedAt)}</p>
					</div>
					<span class="badge" class:badge-success={selected.incident.status === 'Resolved'}
						>{selected.cancellation?.decision === 'approved'
							? 'Cancellation approved'
							: selected.incident.status}</span
					>
				</div>
				<dl class="report-fields">
					<div>
						<dt>Person in distress</dt>
						<dd>{selected.incident.personName}</dd>
					</div>
					<div>
						<dt>Dispatcher</dt>
						<dd>{selected.incident.dispatcherName ?? 'Unavailable'}</dd>
					</div>
					<div>
						<dt>Time started</dt>
						<dd>{date(selected.incident.startedAt)}</dd>
					</div>
					<div>
						<dt>Time ended</dt>
						<dd>{date(selected.incident.endedAt)}</dd>
					</div>
					<div>
						<dt>Location</dt>
						<dd>{selected.locationLabel || 'GPS coordinates below'}</dd>
					</div>
					<div>
						<dt>Caller name</dt>
						<dd>{selected.incident.callerName}</dd>
					</div>
					<div>
						<dt>Caller phone</dt>
						<dd>{selected.incident.callerPhone}</dd>
					</div>
					<div>
						<dt>Caller relationship</dt>
						<dd>{selected.callerRelationship || 'Self'}</dd>
					</div>
					<div>
						<dt>Response duration</dt>
						<dd>{duration(selected.incident.startedAt, selected.incident.endedAt)}</dd>
					</div>
					<div>
						<dt>Latitude / longitude</dt>
						<dd>{selected.latitude}, {selected.longitude}</dd>
					</div>
				</dl>
				{#key selected.incident.id}
					<IncidentCancellationReview
						incidentId={selected.incident.id}
						cancellation={selected.cancellation}
						canReview={ownIncident && selected.incident.status !== 'Resolved'}
						disabled={busy || !!detailError}
						onBusyChange={cancellationBusy}
						onReviewed={async () => {
							if (!disposed) await loadQueue(page, true);
						}}
					/>
				{/key}
				<h3 class="section-heading record-section-heading">Response notes</h3>
				<p class="notes-copy whitespace-pre-wrap">
					{selected.notes || 'No additional information recorded.'}
				</p>
				{#key `${route.data.account?.id}:${selected.incident.id}`}
					<AiReportSummary
						incidentId={selected.incident.id}
						ai={selected.ai}
						canManage={ownIncident}
						disabled={busy || !!detailError}
						onBusyChange={cancellationBusy}
						onChanged={async () => {
							if (!disposed) await loadQueue(page, true, true);
						}}
					/>
				{/key}
				{#if ownIncident}
					<div class="flex flex-wrap gap-3" aria-label="Update incident status">
						<button
							class="btn btn-primary"
							disabled={busy || selected.incident.status !== 'In progress'}
							onclick={() => changeStatus('On route')}>Mark on route</button
						>
						<button
							class="btn btn-primary"
							disabled={busy ||
								selected.incident.status !== 'On route' ||
								selected.cancellation?.decision === 'pending'}
							onclick={() => changeStatus('Resolved')}>Mark resolved</button
						>
					</div>
				{/if}
				<p class="report-footer">
					<FileText size={14} /> Saved incident record{route.data.account?.role === 'admin'
						? ' · Read-only admin view'
						: ''}
				</p>
			{:else}<div class="empty-report">
					<FileText size={23} />
					<p>Select a report to view its saved details.</p>
				</div>{/if}
		</article>
	</div>
</div>

<style>
	.records-cue,
	.document-label {
		display: flex;
		align-items: center;
		gap: 8px;
		color: #98d4e4;
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.14em;
	}
	.reports-workspace .report-archive {
		border-top: 3px solid #68afc4;
		background: #111a20;
	}
	.archive-heading {
		display: flex;
		align-items: center;
		gap: 10px;
		color: #c3e5ed;
	}
	.archive-copy {
		margin-top: 10px;
		font-size: 12px;
		line-height: 1.6;
		color: #b3c6ce;
	}
	.report-choices {
		max-height: 560px;
		overflow: auto;
		border-block: 1px solid #3a515d;
	}
	.reports-workspace .report-document {
		min-width: 0;
		border-top: 5px solid #8bc6d4;
		background: #141e24;
	}
	.document-heading {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		justify-content: space-between;
		gap: 16px;
		padding-bottom: 24px;
		border-bottom: 1px solid #3a515d;
	}
	.document-label {
		margin-bottom: 12px;
	}
	.record-icon {
		display: grid;
		place-items: center;
		flex-shrink: 0;
		width: 32px;
		height: 40px;
		border: 1px solid #517484;
		border-radius: 3px 9px 3px 3px;
		background: #192a34;
		color: #a8dcea;
	}
	.record-section-heading {
		border-left: 3px solid #8bc6d4;
		padding-left: 12px;
	}
	.report-grid {
		display: grid;
		grid-template-columns: minmax(260px, 0.7fr) minmax(0, 1.3fr);
		gap: 22px;
		align-items: start;
	}
	.reports-workspace .report-choice {
		display: flex;
		align-items: center;
		gap: 13px;
		width: 100%;
		border: 0;
		border-bottom: 1px solid #30424d;
		border-left: 3px solid transparent;
		padding: 16px 10px;
		border-radius: 0;
		text-align: left;
		overflow-wrap: anywhere;
	}
	.reports-workspace .report-choice.active {
		background: #223843;
		border-left-color: #9bd5e5;
	}
	.reports-workspace .report-choice:hover {
		background: #1d303a;
	}
	.report-choice strong {
		font-size: 13px;
	}
	.reports-workspace .report-choice small {
		display: block;
		font-size: 12px;
		margin-top: 3px;
		color: #bdced5;
	}
	.reports-workspace .report-fields {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 23px;
		padding: 25px 0;
		margin: 23px 0 12px;
		border-block: 0;
	}
	.report-fields > div {
		padding-bottom: 14px;
		border-bottom: 1px solid #3a515d;
	}
	.reports-workspace .report-fields dt {
		font-size: 12px;
		color: #b3c6ce;
		margin-bottom: 5px;
	}
	.report-fields dd {
		font-size: 13px;
		font-weight: 500;
		overflow-wrap: anywhere;
	}
	.reports-workspace .notes-copy {
		font-size: 14px;
		line-height: 1.8;
		color: #d1dfe5;
		padding: 12px 0 20px;
	}
	.reports-workspace .report-footer {
		font-size: 12px;
		color: #b3c6ce;
		display: flex;
		align-items: center;
		gap: 6px;
		border-top: 1px solid #3a515d;
		padding-top: 20px;
		margin-top: 25px;
	}
	.empty-report {
		display: grid;
		justify-items: center;
		text-align: center;
		gap: 12px;
		padding: 25px 0;
		color: #c5c5bd;
		font-size: 13px;
	}
	@media (max-width: 1050px) {
		.report-grid {
			grid-template-columns: 1fr;
		}
		.report-choices {
			max-height: 240px;
		}
	}
	@media (max-width: 420px) {
		.reports-workspace .report-fields {
			grid-template-columns: 1fr;
			gap: 17px;
		}
		.report-document {
			padding: 18px;
		}
	}
</style>
