<script lang="ts">
	/* eslint svelte/no-navigation-without-resolve: "off" -- beforeNavigate supplies a destination already resolved by SvelteKit. */
	import { onMount } from 'svelte';
	import IncidentCancellationReview from './IncidentCancellationReview.svelte';
	import { resolve } from '$app/paths';
	import { beforeNavigate, goto } from '$app/navigation';
	import { page as route, navigating as navigationState } from '$app/state';
	import { Check, Search, Info, ShieldCheck, Siren } from '@lucide/svelte';
	import type { IncidentDetail, IncidentSummary, IncidentStatus } from '#lib/incidents.ts';
	let { role = 'dispatch' }: { role?: 'dispatch' | 'admin' } = $props();
	let incidents = $state<IncidentSummary[]>([]);
	let selected = $state<IncidentDetail | null>(null);
	let selectedId = $state('');
	let currentUserId = $state('');
	let search = $state('');
	let appliedSearch = '';
	let filter = $state('Active');
	let page = $state(1);
	let total = $state(0);
	let pageSize = $state(20);
	let detail = $state('Personal information');
	let verballyConfirmed = $state(false);
	let draftNotes = $state('');
	let savingNotes = $state(false);
	let noteError = $state('');
	let notesTimer: ReturnType<typeof setTimeout> | undefined;
	let savePromise: Promise<boolean> | undefined;
	let noteConflict = false;
	let navigating = $state(false);
	const leaving = $derived(navigating || !!navigationState.to);
	const notesDirty = $derived(!!selected && draftNotes.trim() !== selected.notes.trim());
	let notice = $state('');
	let queueError = $state('');
	let detailError = $state('');
	let actionError = $state('');
	let loading = $state(true);
	let detailLoading = $state(false);
	let busy = $state(false);
	let queueController: AbortController | undefined;
	let detailController: AbortController | undefined;
	let disposed = false;
	const ownIncident = $derived(
		role === 'dispatch' &&
			!!selected &&
			route.data.account?.id === currentUserId &&
			selected.incident.dispatcherUserId === currentUserId
	);
	const totalPages = $derived(Math.max(1, Math.ceil(total / pageSize)));
	const endpoint = resolve('/api/staff/incidents');
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
			if (response.status === 404) selected = null;
			throw Object.assign(
				new Error(result?.message ?? 'Request failed. Refresh or sign in again.'),
				{ status: response.status }
			);
		}
		if (!result) throw new Error('Invalid server response. Try refreshing this page.');
		return result as T;
	}
	async function loadDetail(id: string, preserveDraft = false) {
		detailController?.abort();
		const controller = new AbortController();
		detailController = controller;
		if (!preserveDraft) detailLoading = true;
		try {
			const result = await request<IncidentDetail>(`${endpoint}/${encodeURIComponent(id)}`, {
				signal: controller.signal
			});
			if (controller.signal.aborted || disposed || id !== selectedId) return;
			const keepDraft = preserveDraft && (notesDirty || savingNotes);
			selected =
				keepDraft && selected
					? { ...result, notes: selected.notes, noteId: selected.noteId }
					: result;
			detailError = '';
			if (!keepDraft) draftNotes = result.notes;
		} catch (cause) {
			if (!controller.signal.aborted && !disposed && id === selectedId) {
				detailError = cause instanceof Error ? cause.message : 'Unable to load incident.';
			}
		} finally {
			if (detailController === controller && !disposed) detailLoading = false;
		}
	}
	async function selectIncident(id: string) {
		if (busy || navigating || !(await flushNotes()) || navigating) return;
		clearTimeout(notesTimer);
		noteError = '';
		noteConflict = false;
		selectedId = id;
		selected = null;
		detail = 'Personal information';
		verballyConfirmed = false;
		draftNotes = '';
		notice = '';
		actionError = '';
		detailError = '';
		void loadDetail(id);
	}
	async function loadQueue(poll = false) {
		if (busy || savingNotes || navigating || (poll && queueController)) return;
		queueController?.abort();
		const controller = new AbortController();
		queueController = controller;
		if (!poll) loading = true;
		try {
			const query = new URLSearchParams({
				search: appliedSearch,
				status: filter,
				page: String(page)
			});
			const result = await request<{
				incidents: IncidentSummary[];
				total: number;
				page: number;
				pageSize: number;
				currentUserId: string;
			}>(`${endpoint}?${query}`, { signal: controller.signal });
			if (controller.signal.aborted || disposed) return;
			incidents = result.incidents;
			total = result.total;
			page = result.page;
			pageSize = result.pageSize;
			currentUserId = result.currentUserId;
			queueError = '';
			if (!selectedId && incidents.length) selectIncident(incidents[0].id);
			else if (selectedId && !detailLoading) await loadDetail(selectedId, true);
		} catch (cause) {
			if (!controller.signal.aborted && !disposed) {
				queueError = cause instanceof Error ? cause.message : 'Unable to load SOS alerts.';
			}
		} finally {
			if (queueController === controller) {
				queueController = undefined;
				if (!disposed) loading = false;
			}
		}
	}
	async function changeQuery(nextPage = 1) {
		if (leaving || !(await flushNotes()) || leaving) return;
		clearTimeout(notesTimer);
		noteError = '';
		noteConflict = false;
		page = nextPage;
		appliedSearch = search.trim();
		detailController?.abort();
		selectedId = '';
		selected = null;
		verballyConfirmed = false;
		draftNotes = '';
		void loadQueue();
	}
	function notesChanged(value: string) {
		if (leaving) return;
		draftNotes = value;
		clearTimeout(notesTimer);
		if (noteConflict) return;
		noteError = '';
		if (notesDirty && value.trim()) notesTimer = setTimeout(() => void flushNotes(), 1200);
	}
	async function flushNotes(): Promise<boolean> {
		clearTimeout(notesTimer);
		if (savePromise) return savePromise;
		if (!notesDirty) return true;
		if (!ownIncident || !selected || selected.incident.status === 'Resolved') {
			noteError = 'These notes cannot be edited. Copy your draft before leaving.';
			return false;
		}
		if (!draftNotes.trim()) {
			noteError = 'Notes cannot be blank. Restore saved notes or enter text.';
			return false;
		}
		if (noteConflict) return false;
		const id = selected.incident.id;
		const accountId = route.data.account?.id;
		const current = () => !disposed && selectedId === id && route.data.account?.id === accountId;
		queueController?.abort();
		detailController?.abort();
		savingNotes = true;
		savePromise = (async () => {
			try {
				while (current() && selected && notesDirty && draftNotes.trim()) {
					const submitted = draftNotes.trim();
					const result: IncidentDetail = await request<IncidentDetail>(
						`${endpoint}/${encodeURIComponent(id)}/notes`,
						{
							method: 'POST',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({ notes: submitted, expectedNoteId: selected.noteId })
						}
					);
					if (!current()) return false;
					selected = result;
					if (draftNotes.trim() === submitted) draftNotes = result.notes;
					noteError = '';
				}
				return current() && !notesDirty;
			} catch (cause) {
				if (current()) {
					noteConflict = (cause as { status?: number }).status === 409;
					noteError = noteConflict
						? 'Notes changed elsewhere or this case closed. Copy your draft, then reload saved notes.'
						: cause instanceof Error
							? cause.message
							: 'Notes were not saved. Retry before leaving.';
				}
				return false;
			} finally {
				savingNotes = false;
				savePromise = undefined;
			}
		})();
		return savePromise;
	}
	async function reloadNotes() {
		if (
			leaving ||
			savingNotes ||
			(notesDirty && !window.confirm('Discard your unsaved draft and reload saved notes?'))
		)
			return;
		clearTimeout(notesTimer);
		noteConflict = false;
		noteError = '';
		await loadDetail(selectedId);
	}
	beforeNavigate((navigation) => {
		if (navigating || (!notesDirty && !savingNotes)) return;
		navigation.cancel();
		const destination = navigation.to?.url;
		if (navigation.willUnload || !destination) {
			void flushNotes();
			return;
		}
		void flushNotes().then(async (saved) => {
			if (!saved || disposed) return;
			navigating = true;
			queueController?.abort();
			detailController?.abort();
			try {
				await goto(destination);
			} catch {
				if (!disposed) actionError = 'Unable to open that page. Your notes are saved.';
			} finally {
				navigating = false;
			}
		});
	});
	async function mutate(action: 'confirm' | 'status' | 'notes', status?: IncidentStatus) {
		if (leaving) return;
		if (action === 'notes') {
			await flushNotes();
			return;
		}
		if (busy || !selected || !(await flushNotes()) || leaving) return;
		busy = true;
		actionError = '';
		notice = '';
		queueController?.abort();
		detailController?.abort();
		const id = selected.incident.id;
		try {
			const result = await request<IncidentDetail>(
				`${endpoint}/${encodeURIComponent(id)}${action === 'status' ? '' : `/${action}`}`,
				{
					method: action === 'status' ? 'PATCH' : 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(action === 'confirm' ? { verballyConfirmed } : { status })
				}
			);
			if (disposed) return;
			selected = result;
			if (action === 'confirm') draftNotes = result.notes;
			if (action === 'confirm') verballyConfirmed = false;
			notice =
				action === 'confirm'
					? 'Incident confirmed. Registered information is now available.'
					: `Incident marked ${status?.toLowerCase()}.`;
		} catch (cause) {
			if (!disposed)
				actionError =
					cause instanceof Error
						? cause.message
						: 'Connection interrupted. Refresh incident before trying again.';
		} finally {
			busy = false;
			if (!disposed) void loadQueue();
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
			if (document.visibilityState === 'visible') void loadQueue(true);
		};
		const interval = setInterval(refresh, 5000);
		document.addEventListener('visibilitychange', refresh);
		return () => {
			disposed = true;
			clearInterval(interval);
			clearTimeout(notesTimer);
			document.removeEventListener('visibilitychange', refresh);
			queueController?.abort();
			detailController?.abort();
		};
	});
</script>

<svelte:head
	><title>{role === 'admin' ? 'Active incidents' : 'SOS alerts'} · HandLink</title></svelte:head
>
<div class="staff-workspace space-y-5">
	<header class="flex flex-wrap items-center justify-between gap-4">
		<div class="response-title">
			<span class="response-icon"><Siren size={28} aria-hidden="true" /></span>
			<div>
				<p class="response-cue">LIVE RESPONSE</p>
				<h1 class="page-heading">{role === 'admin' ? 'Active incidents' : 'SOS alerts'}</h1>
			</div>
		</div>
		<button
			class="btn btn-outline btn-sm"
			disabled={busy || leaving || loading}
			onclick={() => loadQueue()}>Refresh alerts</button
		>
	</header>
	<p class="response-purpose">
		{role === 'admin'
			? 'Monitor active incidents, response status and dispatcher assignments.'
			: 'New SOS alerts and active response. Confirm a caller before viewing registered details.'}
	</p>
	<p class="preview-note">
		<Info size={17} /> Alerts refresh every 5 seconds while this page is visible. Calls use your separate
		dispatch system.
	</p>
	{#if queueError}<p class="alert alert-error" role="alert">
			{queueError} Last loaded alerts may be outdated.
			<button class="btn btn-sm" onclick={() => loadQueue()} disabled={busy || leaving}
				>Retry alerts</button
			>
		</p>{/if}
	{#if notice}<p class="alert" role="status"><Check size={17} />{notice}</p>{/if}
	{#if actionError}<p class="alert alert-error" role="alert">{actionError}</p>{/if}
	<div class="incident-grid">
		<section
			class="panel incident-list"
			aria-labelledby="incident-list-heading"
			aria-busy={loading}
		>
			<div class="list-heading">
				<Siren size={20} aria-hidden="true" />
				<h2 id="incident-list-heading" class="section-heading">
					{role === 'admin' ? 'Active incidents' : 'Incoming SOS alerts'}
				</h2>
			</div>
			<form
				class="queue-tools"
				onsubmit={(event) => {
					event.preventDefault();
					changeQuery();
				}}
			>
				<label class="input w-full"
					><Search size={17} /><input
						aria-label="Search incidents"
						placeholder="Search name or incident reference"
						maxlength="100"
						bind:value={search}
						disabled={busy || leaving}
					/></label
				>
				<select
					class="select w-full"
					aria-label="Filter incidents"
					bind:value={filter}
					onchange={() => changeQuery()}
					disabled={busy || leaving}
				>
					<option>Active</option><option>All</option><option>Not assigned</option><option
						>In progress</option
					><option>On route</option><option>Resolved</option>
				</select>
				<button class="btn btn-outline btn-sm" disabled={busy || leaving}>Search alerts</button>
			</form>
			{#if loading}<p class="empty-queue" role="status">Loading alerts...</p>{/if}
			<div class="queue-items">
				{#each incidents as incident (incident.id)}
					<button
						class="incident-row"
						class:selected={selectedId === incident.id}
						aria-pressed={selectedId === incident.id}
						disabled={busy || leaving}
						onclick={() => selectIncident(incident.id)}
					>
						<span class="queue-row-top"
							><strong>{incident.personName}</strong><span class="incident-id"
								>{incident.reference}</span
							></span
						>
						<span class="row-footer"
							><span class="incident-status" class:resolved={incident.status === 'Resolved'}
								>{incident.status}</span
							><span>{date(incident.startedAt)}</span>{#if incident.cancellationPending}<span
									class="badge badge-sm badge-warning">Cancellation requested</span
								>{/if}</span
						>
					</button>
				{:else}
					{#if !loading && !queueError}<div class="empty-queue">
							<h3>No matching incidents</h3>
							<p>New SOS alerts appear here. Try another search or filter.</p>
						</div>{/if}
				{/each}
			</div>
			<div class="queue-footnote flex flex-wrap items-center justify-between gap-3">
				<span>{total} incidents · Page {page} of {totalPages}</span>
				<div class="flex gap-2">
					<button
						class="btn btn-ghost btn-sm"
						disabled={busy || leaving || loading || page <= 1}
						onclick={() => changeQuery(page - 1)}>Previous</button
					><button
						class="btn btn-ghost btn-sm"
						disabled={busy || leaving || loading || page >= totalPages}
						onclick={() => changeQuery(page + 1)}>Next</button
					>
				</div>
			</div>
		</section>
		<section
			class="panel incident-details"
			aria-labelledby="details-heading"
			aria-busy={detailLoading || busy}
		>
			{#if detailError}<p class="mb-4 alert alert-error" role="alert">
					{detailError}<button
						class="btn btn-sm"
						disabled={busy || leaving}
						onclick={() => loadDetail(selectedId, true)}>Retry incident</button
					>
				</p>{/if}
			{#if detailLoading}<h2 id="details-heading" class="section-heading">Loading incident...</h2>
			{:else if selected}
				<header class="detail-header">
					<div>
						<p class="eyebrow">INCIDENT REFERENCE {selected.incident.reference}</p>
						<h2 id="details-heading" class="detail-name">{selected.incident.personName}</h2>
						<p class="muted">
							{selected.cancellation?.decision === 'approved'
								? 'Cancellation approved'
								: selected.incident.status}
						</p>
					</div>
				</header>
				<table class="detail-table mb-6">
					<tbody>
						{#each [['Started', date(selected.incident.startedAt)], ['Confirmed', date(selected.incident.confirmedAt)], ['Ended', date(selected.incident.endedAt)], ['Dispatcher', selected.incident.dispatcherName || 'Not assigned']] as [label, value] (label)}<tr
							>
								<th scope="row">{label}</th>
								<td>{value}</td>
							</tr>{/each}
					</tbody>
				</table>
				{#key selected.incident.id}
					<IncidentCancellationReview
						incidentId={selected.incident.id}
						cancellation={selected.cancellation}
						canReview={ownIncident &&
							selected.incident.status !== 'Resolved' &&
							selected.incident.status !== 'Not assigned'}
						disabled={busy || leaving || !!detailError}
						onBusyChange={cancellationBusy}
						onReviewed={async () => {
							if (!disposed) await loadQueue();
						}}
					/>
				{/key}
				{#if !selected.personal}
					<div class="confirmation-panel">
						<ShieldCheck size={27} />
						<h3 class="section-heading">
							{role === 'dispatch' && selected.incident.status === 'Not assigned'
								? 'Confirm caller identity'
								: 'Registered information restricted'}
						</h3>
						<p>
							{role === 'admin'
								? 'Admin oversight shows incident status. Medical and registered information are available only to the assigned dispatcher.'
								: selected.incident.status === 'Not assigned'
									? 'Verbally confirm the caller’s name and phone number before opening registered information.'
									: 'Only the assigned dispatcher can view registered information and update this incident.'}
						</p>
						<table class="detail-table">
							<tbody>
								<tr>
									<th scope="row">Caller name</th>
									<td>{selected.incident.callerName}</td>
								</tr>
								<tr>
									<th scope="row">Caller phone number</th>
									<td>{selected.incident.callerPhone}</td>
								</tr>
							</tbody>
						</table>
						{#if role === 'dispatch' && selected.incident.status === 'Not assigned'}<label
								class="confirmation-check"
								><input
									class="checkbox"
									type="checkbox"
									bind:checked={verballyConfirmed}
									disabled={busy || leaving}
								/> I verbally confirmed the caller’s name and phone number.</label
							>{/if}
						{#if role === 'dispatch' && selected.incident.status === 'Not assigned'}<button
								class="confirm-button btn"
								disabled={!verballyConfirmed || busy || !!detailError}
								onclick={() => mutate('confirm')}>Confirm incident</button
							>{/if}
					</div>
				{:else}
					<div class="detail-tabs" aria-label="Incident detail sections">
						{#each ['Personal information', 'Medical information', 'Emergency contacts', 'Additional information'] as tab (tab)}<button
								class:active={detail === tab}
								aria-pressed={detail === tab}
								onclick={() => {
									detail = tab;
								}}>{tab}</button
							>{/each}
					</div>
					{#if detail === 'Personal information'}
						<table class="detail-table">
							<tbody>
								{#each [['First name', selected.personal.firstName], ['Last name', selected.personal.lastName], ['Age', selected.personal.age + ' years'], ['Sex', selected.personal.sex], ['Longitude', selected.personal.longitude.toFixed(6)], ['Latitude', selected.personal.latitude.toFixed(6)], ['Phone number', selected.personal.phone], ['Status', selected.incident.status], ['Incident reference', selected.incident.reference], ['Pinged location', selected.personal.locationLabel]] as [label, value] (label)}<tr
									>
										<th scope="row">{label}</th>
										<td>{value || 'Not provided'}</td>
									</tr>{/each}
							</tbody>
						</table>
					{:else if detail === 'Medical information'}
						{#if selected.medical}<table class="detail-table">
								<tbody>
									{#each [['Blood type', selected.medical.bloodType], ['Chronic conditions', selected.medical.chronicCondition], ['Allergies', selected.medical.allergies], ['Current medications', selected.medical.currentMedications], ['Additional medical information', selected.medical.additionalInformation]] as [label, value] (label)}<tr
										>
											<th scope="row">{label}</th>
											<td>{value || 'Not provided'}</td>
										</tr>{/each}
								</tbody>
							</table>{:else}<p class="muted">No medical information registered.</p>{/if}
					{:else if detail === 'Emergency contacts'}
						{#each selected.emergencyContacts as contact, index (index)}<table
								class="detail-table mb-6"
							>
								<tbody>
									{#each [['First name', contact.firstName], ['Last name', contact.lastName], ['Relationship', contact.relationship], ['Phone number', contact.phone], ['Email', contact.email]] as [label, value] (label)}<tr
										>
											<th scope="row">{label}</th>
											<td>{value || 'Not provided'}</td>
										</tr>{/each}
								</tbody>
							</table>{:else}<p class="muted">No emergency contacts registered.</p>{/each}
					{:else}
						<form
							class="detail-content"
							onsubmit={(event) => {
								event.preventDefault();
								void mutate('notes');
							}}
						>
							<label class="field-label"
								>Additional information<textarea
									class="textarea min-h-40 w-full"
									maxlength="2000"
									required
									value={draftNotes}
									oninput={(event) => notesChanged(event.currentTarget.value)}
									onblur={() => void flushNotes()}
									disabled={busy ||
										leaving ||
										!ownIncident ||
										selected.incident.status === 'Resolved'}></textarea></label
							>
							<button
								class="btn btn-outline"
								disabled={busy ||
									leaving ||
									!ownIncident ||
									selected.incident.status === 'Resolved' ||
									!draftNotes.trim() ||
									savingNotes ||
									!notesDirty}>Save notes</button
							>

							<p role="status" class="muted">
								{savingNotes
									? 'Saving notes...'
									: noteError
										? 'Notes not saved'
										: notesDirty
											? 'Unsaved changes'
											: 'Notes saved'}
							</p>
							{#if noteError}<p role="alert" class="alert alert-error">{noteError}</p>{/if}
							{#if noteError || notesDirty}<button
									type="button"
									class="btn btn-outline"
									disabled={savingNotes}
									onclick={reloadNotes}>Reload saved notes</button
								>{/if}
							{#if selected.incident.status === 'Resolved'}<p class="muted">
									Resolved incident notes are read-only.
								</p>{/if}
						</form>
					{/if}
				{/if}
				{#if role === 'dispatch'}
					<div class="detail-actions">
						<button
							class="on-route-button btn"
							disabled={busy ||
								leaving ||
								!!detailError ||
								!ownIncident ||
								notesDirty ||
								savingNotes ||
								!!noteError ||
								selected.incident.status !== 'In progress'}
							onclick={() => mutate('status', 'On route')}>Mark on route</button
						><button
							class="resolved-button btn"
							disabled={busy ||
								leaving ||
								!!detailError ||
								!ownIncident ||
								notesDirty ||
								savingNotes ||
								!!noteError ||
								selected.incident.status !== 'On route' ||
								selected.cancellation?.decision === 'pending'}
							onclick={() => mutate('status', 'Resolved')}>Mark resolved</button
						>
					</div>
				{/if}
			{:else}<h2 id="details-heading" class="section-heading">Select an SOS alert</h2>
				<p class="muted mt-4">Choose an incident from the queue to view its status.</p>{/if}
		</section>
	</div>
</div>

<style>
	.response-title {
		display: flex;
		align-items: center;
		gap: 14px;
	}
	.response-icon {
		display: grid;
		place-items: center;
		flex-shrink: 0;
		width: 58px;
		height: 58px;
		border: 1px solid #a35e4e;
		border-radius: 16px;
		background: #3b211e;
		color: #ffb09a;
	}
	.response-cue {
		margin-bottom: 5px;
		color: #ffb09a;
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.15em;
	}
	.response-purpose {
		max-width: 70ch;
		color: #e2cdc5;
		font-size: 14px;
		line-height: 1.7;
	}
	.staff-workspace .incident-list {
		border-top: 4px solid #e58b70;
	}
	.staff-workspace .incident-details {
		border-top: 4px solid #a16b43;
	}
	.incident-grid {
		display: grid;
		grid-template-columns: minmax(250px, 0.85fr) minmax(0, 1.4fr);
		gap: 22px;
		align-items: start;
	}
	.incident-list {
		padding: 0;
		overflow: hidden;
	}
	.list-heading {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 22px;
		color: #ffd0bd;
	}
	.queue-tools {
		display: grid;
		gap: 10px;
		padding: 0 22px 20px;
	}
	.incident-row {
		display: block;
		width: 100%;
		text-align: left;
		border-top: 1px solid #555;
		padding: 20px;
	}
	.incident-row:hover,
	.incident-row.selected {
		background: #352621;
	}
	.incident-row.selected {
		box-shadow: inset 4px 0 #ffac8c;
	}
	.queue-row-top,
	.row-footer,
	.detail-header {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		align-items: center;
	}
	.queue-row-top {
		flex-wrap: wrap;
	}
	.incident-id,
	.row-footer,
	.queue-footnote {
		color: #c3c4bb;
		font-size: 12px;
	}
	.row-footer {
		margin-top: 12px;
	}
	.incident-status.resolved {
		color: #a0d1a7;
	}
	.queue-footnote {
		padding: 16px 22px;
		border-top: 1px solid #555;
	}
	.empty-queue {
		padding: 30px 22px;
	}
	.incident-details {
		padding: 24px;
	}
	.detail-header {
		align-items: flex-start;
		flex-wrap: wrap;
		margin-bottom: 24px;
	}
	.detail-name {
		font-size: 23px;
		margin: 5px 0;
	}
	.detail-tabs {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
		border-bottom: 1px solid #555;
		margin-bottom: 24px;
	}
	.detail-tabs button {
		min-height: 44px;
		font-size: 12px;
		padding: 8px 4px;
		border-bottom: 2px solid transparent;
	}
	.detail-tabs button.active {
		border-color: #f1dd71;
		color: #f1dd71;
	}
	.detail-table {
		width: 100%;
		border-collapse: collapse;
		table-layout: fixed;
	}

	.detail-table th,
	.detail-table td {
		padding: 12px 10px;
		border: 1px solid var(--color-base-300, #555);
		font-size: 14px;
		text-align: left;
		vertical-align: top;
		overflow-wrap: anywhere;
	}
	.detail-table th {
		width: 38%;
		font-weight: 600;
		background: var(--color-base-200, #34352d);
	}
	.confirmation-panel,
	.detail-content {
		display: grid;
		gap: 20px;
	}
	.confirmation-check {
		display: flex;
		gap: 12px;
		align-items: flex-start;
		font-size: 14px;
		line-height: 1.6;
	}
	.confirmation-check input {
		flex-shrink: 0;
	}
	.detail-actions {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		margin-top: 28px;
		padding-top: 20px;
		border-top: 1px solid #555;
		flex-wrap: wrap;
	}
	.on-route-button {
		background: #e3cd5e;
		color: #242417;
		border-color: #e3cd5e;
	}
	.resolved-button {
		background: #47734c;
		color: #fff;
		border-color: #47734c;
	}
	.on-route-button:disabled,
	.resolved-button:disabled {
		background: #34352d;
		border-color: #555;
		color: #aaa;
	}
	@media (max-width: 900px) {
		.incident-grid {
			grid-template-columns: minmax(0, 1fr);
		}
		.queue-items {
			max-height: 420px;
			overflow: auto;
		}
	}
	@media (max-width: 420px) {
		.incident-details {
			padding: 18px;
		}
		.detail-table th,
		.detail-table td {
			font-size: 13px;
		}
	}
</style>
