<script lang="ts">
	import { onMount } from 'svelte';
	import { SvelteURLSearchParams } from 'svelte/reactivity';
	import IncidentCancellationReview from './IncidentCancellationReview.svelte';
	import IncidentLocation from './IncidentLocation.svelte';
	import IncidentProgress from './IncidentProgress.svelte';
	import { incidentStatusLabel } from '#lib/incidents.ts';
	import { routingDescription } from '#lib/lgu.ts';
	import AiReportSummary from './AiReportSummary.svelte';
	import { page as route } from '$app/state';
	import { resolve } from '$app/paths';
	import { beforeNavigate } from '$app/navigation';
	import { Archive, Check, Download, FileText, RefreshCw, Search } from '@lucide/svelte';
	import { incidentDuration, type IncidentReport, type IncidentSummary } from '#lib/incidents.ts';
	let incidents = $state<IncidentSummary[]>([]);
	let selected = $state<IncidentReport | null>(null);
	let selectedId = $state('');
	let currentUserId = $state('');
	let search = $state('');
	let appliedQuery = $state('');
	let from = $state('');
	let to = $state('');
	let dispatcherId = $state('');
	let lguId = $state('');
	let sosType = $state('all');
	let exporting = $state(false);
	let options = $state<{
		dispatchers: { id: string; name: string }[];
		lgus: { id: string; name: string }[];
	}>({ dispatchers: [], lgus: [] });
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
	let addendumDraft = $state('');
	let addendumRetry: { id: string; incidentId: string; notes: string } | undefined;
	let queueController: AbortController | undefined;
	let detailController: AbortController | undefined;
	let disposed = false;
	const endpoint = resolve('/api/staff/incidents');
	const totalPages = $derived(Math.max(1, Math.ceil(total / pageSize)));
	const ownIncident = $derived(
		route.data.account?.role === 'dispatcher' &&
			!!route.data.account.provincialDispatcher === !!selected?.incident.provincialWorkflow &&
			currentUserId === route.data.account.id &&
			!!selected &&
			selected.incident.dispatcherUserId === currentUserId
	);
	function date(value: string | null) {
		return value ? new Date(value).toLocaleString() : 'Not yet';
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
		if (addendumDraft.trim() && !window.confirm('Discard your unsaved addendum?')) return;
		selectedId = id;
		selected = null;
		addendumDraft = '';
		addendumRetry = undefined;
		actionError = '';
		notice = '';
		void loadDetail(id);
	}
	async function loadQueue(nextPage = page, keepSelection = false, poll = false) {
		if (busy || (poll && (queueController || detailLoading))) return;
		if (!keepSelection && addendumDraft.trim() && !window.confirm('Discard your unsaved addendum?'))
			return;
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
			addendumDraft = '';
			addendumRetry = undefined;
		}
		try {
			const query =
				poll && appliedQuery
					? new SvelteURLSearchParams(appliedQuery)
					: new SvelteURLSearchParams({
							view: 'reports',
							search: search.trim(),
							status: filter,
							sosType
						});
			if (!poll)
				for (const [key, value] of Object.entries({ from, to, dispatcherId, lguId })) {
					if (value) query.set(key, value);
				}
			query.set('page', String(nextPage));
			const result = await request<{
				incidents: IncidentSummary[];
				total: number;
				page: number;
				pageSize: number;
				currentUserId: string;
			}>(`${endpoint}?${query}`, { signal: controller.signal });
			if (disposed || controller.signal.aborted) return;
			appliedQuery = query.toString();
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
	async function exportPdf() {
		if (exporting || !appliedQuery || loading || queueError) return;
		exporting = true;
		actionError = '';
		try {
			const response = await fetch(`${resolve('/api/staff/reports/export')}?${appliedQuery}`, {
				cache: 'no-store'
			});
			if (!response.ok) {
				const result = await response.json().catch(() => null);
				throw new Error(result?.message ?? 'PDF export failed. Refresh and retry.');
			}
			const blob = await response.blob();
			if (disposed) return;
			const url = URL.createObjectURL(blob);
			const link = document.createElement('a');
			link.href = url;
			link.download = 'handlink-filtered-reports.pdf';
			link.click();
			setTimeout(() => URL.revokeObjectURL(url), 60000);
		} catch (cause) {
			if (!disposed) actionError = cause instanceof Error ? cause.message : 'PDF export failed.';
		} finally {
			if (!disposed) exporting = false;
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
	async function saveAddendum() {
		if (busy || !selected || !ownIncident || selected.incident.status !== 'Resolved') return;
		const notes = addendumDraft.trim();
		if (!notes || notes.length > 2000) return;
		const id = selected.incident.id;
		const accountId = route.data.account?.id;
		if (!addendumRetry || addendumRetry.incidentId !== id || addendumRetry.notes !== notes)
			addendumRetry = { id: crypto.randomUUID(), incidentId: id, notes };
		const submission = addendumRetry;
		busy = true;
		actionError = '';
		notice = '';
		queueController?.abort();
		detailController?.abort();
		try {
			await request(resolve('/api/staff/reports/[id]/addenda', { id }), {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id: submission.id, notes })
			});
			if (disposed || selectedId !== id || route.data.account?.id !== accountId) return;
			addendumDraft = '';
			addendumRetry = undefined;
			notice = 'Addendum saved. Original notes kept.';
			await loadDetail(id, true);
		} catch (cause) {
			if (!disposed && selectedId === id && route.data.account?.id === accountId)
				actionError =
					cause instanceof Error ? cause.message : 'Addendum was not saved. Retry before leaving.';
		} finally {
			if (!disposed) busy = false;
		}
	}
	function cancellationBusy(value: boolean) {
		busy = value;
		if (value) {
			queueController?.abort();
			detailController?.abort();
		}
	}
	beforeNavigate((navigation) => {
		if (!addendumDraft.trim()) return;
		if (busy || (!navigation.willUnload && !window.confirm('Discard your unsaved addendum?')))
			navigation.cancel();
		else if (navigation.willUnload) navigation.cancel();
	});
	onMount(() => {
		void loadQueue();
		void request<typeof options>(resolve('/api/staff/reports/filters'))
			.then((result) => {
				if (!disposed) options = result;
			})
			.catch(() => {
				if (!disposed) actionError = 'Could not load LGU and dispatcher filters. Refresh to retry.';
			});
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
						aria-label="Status"
						disabled={busy}
						onchange={(event) => {
							filter = event.currentTarget.value;
							void loadQueue(1);
						}}
						><option>All</option><option value="In progress"
							>{route.data.account?.provincialDispatcher ? 'Coordinating' : 'In progress'}</option
						><option>On route</option><option>Resolved</option></select
					></label
				>
				<label class="field-label"
					>From date<input
						class="input w-full"
						type="date"
						bind:value={from}
						max={to || undefined}
						disabled={busy}
					/></label
				>
				<label class="field-label"
					>To date<input
						class="input w-full"
						type="date"
						bind:value={to}
						min={from || undefined}
						disabled={busy}
					/></label
				>
				<p class="muted text-xs">
					Incident start dates in Philippine time. Both dates are included.
				</p>
				<label class="field-label"
					>Dispatcher<select
						aria-label="Dispatcher"
						class="select w-full"
						bind:value={dispatcherId}
						disabled={busy}
						><option value="">All permitted dispatchers</option
						>{#each options.dispatchers as staff (staff.id)}<option value={staff.id}
								>{staff.name}</option
							>{/each}</select
					></label
				>
				<label class="field-label"
					>LGU<select aria-label="LGU" class="select w-full" bind:value={lguId} disabled={busy}
						><option value="">All permitted LGUs</option>{#each options.lgus as lgu (lgu.id)}<option
								value={lgu.id}>{lgu.name}</option
							>{/each}</select
					></label
				>
				<label class="field-label"
					>SOS type<select
						aria-label="SOS type"
						class="select w-full"
						bind:value={sosType}
						disabled={busy}
						><option value="all">All SOS types</option><option value="self">For self</option><option
							value="trusted">For a trusted person</option
						></select
					></label
				>
				<button class="btn w-full btn-outline" disabled={busy || loading}>Apply filters</button>
			</form>
			<button
				type="button"
				class="btn mt-3 w-full btn-primary"
				disabled={busy || loading || exporting || !!queueError || !total}
				onclick={exportPdf}
				><Download size={17} />{exporting ? 'Creating PDF…' : 'Download filtered PDF'}</button
			>
			<p class="muted mt-2 text-xs">
				PDF uses applied filters across all pages. Maximum 100 reports. Apply changes before
				downloading.
			</p>
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
									>{incidentStatusLabel(record)} | {date(record.startedAt)}</small
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
							: incidentStatusLabel(selected.incident)}</span
					>
				</div>
				<table class="report-fields">
					<tbody>
						<tr>
							<th scope="row">Person in distress</th>
							<td>{selected.incident.personName}</td>
						</tr>
						<tr>
							<th scope="row">Dispatcher</th>
							<td>{selected.incident.dispatcherName ?? 'Unavailable'}</td>
						</tr>
						<tr>
							<th scope="row">Time started</th>
							<td>{date(selected.incident.startedAt)}</td>
						</tr>
						<tr>
							<th scope="row">Time ended</th>
							<td>{date(selected.incident.endedAt)}</td>
						</tr>
						<tr>
							<th scope="row">Caller name</th>
							<td>{selected.incident.callerName}</td>
						</tr>
						<tr>
							<th scope="row">Caller phone</th>
							<td>{selected.incident.callerPhone}</td>
						</tr>
						<tr>
							<th scope="row">Caller relationship</th>
							<td>{selected.callerRelationship || 'Self'}</td>
						</tr>
						<tr>
							<th scope="row">Response duration</th>
							<td>{incidentDuration(selected.incident.startedAt, selected.incident.endedAt)}</td>
						</tr>
					</tbody>
				</table>
				<p class="muted">
					LGU: {selected.incident.lguName ?? 'Unrouted — central review'} · Routing: {routingDescription(
						selected.incident.routingReason
					)}
				</p>
				{#key selected.incident.id}
					<IncidentLocation
						personLocation={selected.personLocation}
						reporter={selected}
						isForSomeoneElse={selected.incident.isForSomeoneElse}
					/>
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
				<section class="addenda-section" aria-labelledby="addenda-heading">
					<h3 id="addenda-heading" class="section-heading record-section-heading">
						Report addenda
					</h3>
					{#each selected.addenda as addendum (addendum.id)}
						<article class="addendum-entry">
							<p class="muted text-sm">{addendum.authorName} · {date(addendum.createdAt)}</p>
							<p class="notes-copy whitespace-pre-wrap">{addendum.notes}</p>
						</article>
					{:else}<p class="muted">No addenda.</p>{/each}
					{#if ownIncident && selected.incident.status === 'Resolved'}
						<form
							class="mt-4 space-y-3"
							onsubmit={(event) => {
								event.preventDefault();
								void saveAddendum();
							}}
						>
							<label class="field-label" for="report-addendum">Addendum *</label>
							<textarea
								id="report-addendum"
								class="textarea min-h-32 w-full"
								maxlength="2000"
								required
								bind:value={addendumDraft}
								disabled={busy}></textarea>
							<p class="muted text-sm">
								Add a correction or update. Original notes stay unchanged.
							</p>
							<button class="btn btn-primary" disabled={busy || !addendumDraft.trim()}
								>Save addendum</button
							>
						</form>
					{/if}
				</section>
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
				{#if selected.incident.provincialWorkflow}
					{#key selected.incident.id}<IncidentProgress
							incident={selected.incident}
							updates={selected.responseUpdates}
							canUpdate={ownIncident}
							disabled={busy || !!detailError}
							onBusyChange={cancellationBusy}
							onSaved={async () => {
								await loadQueue(page, true, true);
							}}
						/>{/key}
				{/if}
				{#if ownIncident && !selected.incident.provincialWorkflow}
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
		width: 100%;
		table-layout: fixed;
		border-collapse: collapse;
		margin: 23px 0 12px;
	}
	.report-fields th,
	.report-fields td {
		border: 1px solid var(--color-base-300, #3a515d);
		padding: 12px;
		text-align: left;
		vertical-align: top;
		overflow-wrap: anywhere;
		font-size: 14px;
	}
	.report-fields th {
		width: 38%;
		background: var(--color-base-200, #25343b);
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
	.addendum-entry {
		padding: 14px 0;
		border-bottom: 1px solid var(--color-base-300, #3a515d);
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
		.report-fields th,
		.report-fields td {
			padding: 10px 8px;
		}
		.report-document {
			padding: 18px;
		}
	}
</style>
