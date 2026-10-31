<script lang="ts">
	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { apiRequest } from '#lib/client/request.ts';
	import type { IncidentSummary } from '#lib/incidents.ts';
	import { routingDescription } from '#lib/lgu.ts';
	import type { PageProps } from './$types';
	let { data }: PageProps = $props();
	let editing = $state('');
	let name = $state('');
	let boundaryText = $state('');
	let active = $state(false);
	let busy = $state(false);
	let error = $state('');
	let notice = $state('');
	let unrouted = $state<IncidentSummary[]>([]);
	let total = $state(0);
	let queueLgu = $state('unrouted');
	let queueVersion = 0;
	let queueController: AbortController | null = null;
	let selections = $state<Record<string, string>>({});
	function edit(row?: (typeof data.lgus)[number]) {
		editing = row?.id ?? '';
		name = row?.name ?? '';
		active = row?.active ?? false;
		boundaryText = row?.boundary ? JSON.stringify(row.boundary, null, 2) : '';
		error = '';
		notice = '';
	}
	async function refreshQueue() {
		const version = ++queueVersion;
		queueController?.abort();
		const controller = new AbortController();
		queueController = controller;
		const query = new URLSearchParams({ lguId: queueLgu, status: 'Not assigned' });
		try {
			const result = await apiRequest<{ incidents: IncidentSummary[]; total: number }>(
				`/api/staff/incidents?${query}`,
				{ signal: controller.signal }
			);
			if (version !== queueVersion) return;
			unrouted = result.incidents;
			total = result.total;
		} catch (reason) {
			if (!controller.signal.aborted) throw reason;
		} finally {
			if (queueController === controller) queueController = null;
		}
	}
	onMount(() => {
		const refresh = () => {
			if (!busy && !document.hidden && !queueController)
				void refreshQueue().catch(
					(reason) =>
						(error = reason instanceof Error ? reason.message : 'Could not load routing queue.')
				);
		};
		refresh();
		const interval = setInterval(refresh, 5000);
		return () => {
			clearInterval(interval);
			queueVersion++;
			queueController?.abort();
		};
	});
	async function save(event: SubmitEvent) {
		event.preventDefault();
		if (busy) return;
		busy = true;
		error = '';
		notice = '';
		try {
			let boundary: unknown = null;
			try {
				boundary = boundaryText.trim() ? JSON.parse(boundaryText) : null;
			} catch {
				throw new Error('Boundary is not valid JSON.');
			}
			await apiRequest(
				editing ? `/api/admin/lgus/${encodeURIComponent(editing)}` : '/api/admin/lgus',
				{
					method: editing ? 'PUT' : 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ name, boundary, active })
				}
			);
			await invalidateAll();
			notice = 'LGU saved. Existing incident routing remains unchanged.';
		} catch (reason) {
			error = reason instanceof Error ? reason.message : 'Could not save LGU.';
		} finally {
			busy = false;
		}
	}
	async function importBoundary(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		if (file.size > 2 * 1024 * 1024) {
			error = 'Choose a GeoJSON file smaller than 2 MB.';
			return;
		}
		try {
			boundaryText = await file.text();
			error = '';
		} catch {
			error = 'Could not read the boundary file.';
		}
	}
	async function routeIncident(row: IncidentSummary) {
		if (busy || !selections[row.id]) return;
		busy = true;
		error = '';
		try {
			await apiRequest(`/api/admin/incidents/${row.id}/lgu`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ lguId: selections[row.id] })
			});
			await refreshQueue();
			notice = 'Incident assigned to the selected LGU. Routing was recorded.';
		} catch (reason) {
			error = reason instanceof Error ? reason.message : 'Could not route incident.';
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head><title>LGUs and GPS routing · HandLink</title></svelte:head>
<div class="space-y-6">
	<header>
		<h1 class="page-heading">LGUs and GPS routing</h1>
		<p class="muted mt-3">
			Central administration. Each LGU has its own staff, queues, and reports.
		</p>
	</header>
	{#if error}<p class="alert alert-error" role="alert">{error}</p>{/if}
	{#if notice}<p class="alert" role="status">{notice}</p>{/if}
	<section class="panel space-y-4" aria-label="Configured LGUs">
		<h2 class="section-heading">Configured LGUs</h2>
		{#each data.lgus as row (row.id)}<div
				class="flex flex-wrap items-center justify-between gap-3 border-b py-3"
			>
				<div>
					<strong>{row.name}</strong>
					<p class="muted">
						{row.active ? 'Active' : 'Inactive'} · {row.boundary
							? 'GPS boundary configured'
							: 'No GPS boundary'}
					</p>
				</div>
				<button class="lgu-edit btn btn-outline" disabled={busy} onclick={() => edit(row)}
					>Edit {row.name}</button
				>
			</div>{/each}
		<button class="btn btn-primary" disabled={busy} onclick={() => edit()}>Add LGU</button>
	</section>
	<form class="panel space-y-4" onsubmit={save} aria-label="LGU setup">
		<h2 class="section-heading">{editing ? 'Edit LGU' : 'Add LGU'}</h2>
		<fieldset class="space-y-4" disabled={busy}>
			<label class="block"
				>LGU name *<input
					class="input mt-2 w-full"
					bind:value={name}
					maxlength="100"
					required
					placeholder="Municipality/city, province"
				/></label
			>
			<label class="block"
				>Import GeoJSON boundary<input
					class="file-input mt-2 w-full"
					type="file"
					accept=".json,.geojson,application/json,application/geo+json"
					onchange={importBoundary}
				/></label
			>
			<label class="block"
				>Boundary GeoJSON<textarea
					class="textarea mt-2 min-h-40 w-full"
					bind:value={boundaryText}
					placeholder="Paste an official Polygon, MultiPolygon, or GeoJSON Feature."
				></textarea></label
			>
			<p class="muted">
				Use verified jurisdiction boundaries in [longitude, latitude] order. Maximum 10,000
				vertices. Review boundaries before activation. Overlaps and unmatched points require central
				routing review.
			</p>
			<label class="flex items-center gap-3"
				><input class="checkbox" type="checkbox" bind:checked={active} />Activate this LGU</label
			>
			<p class="muted">
				New LGUs need a valid boundary before activation. Until any boundary is active, Existing LGU
				preserves the current dispatch workflow. Inactive LGU staff cannot enter their workspace.
			</p>
			<button class="btn btn-primary" type="submit">{busy ? 'Saving...' : 'Save LGU'}</button>
		</fieldset>
	</form>
	<section class="panel space-y-4" aria-label="Central routing review">
		<label class="block"
			>Routing queue<select
				class="select mt-2 w-full"
				bind:value={queueLgu}
				disabled={busy}
				onchange={(event) => {
					queueLgu = event.currentTarget.value;
					void refreshQueue().catch((reason) => (error = reason.message));
				}}
				><option value="unrouted">Unrouted incidents</option
				>{#each data.lgus as row (row.id)}<option value={row.id}>{row.name}</option>{/each}</select
			></label
		>
		<div class="flex flex-wrap items-center justify-between gap-3">
			<h2 class="section-heading">Central routing review ({total})</h2>
			<button
				class="btn btn-outline"
				disabled={busy}
				onclick={() => refreshQueue().catch((reason) => (error = reason.message))}
				>Refresh routing queue</button
			>
		</div>
		<p class="muted">
			Review the emergency location with the caller before choosing an LGU. SOS for another person
			is not routed using the caller's position when the beneficiary's shared location is
			unavailable. Existing routing is never silently recalculated.
		</p>
		{#each unrouted as row (row.id)}<article class="space-y-3 border-b py-4">
				<h3 class="font-semibold">{row.reference} · {row.personName}</h3>
				<p>{row.callerName} · {row.callerPhone}</p>
				<p class="muted">Routing: {routingDescription(row.routingReason)}</p>
				{#if row.status === 'Not assigned'}<form
						class="flex flex-wrap items-end gap-3"
						onsubmit={(event) => {
							event.preventDefault();
							void routeIncident(row);
						}}
					>
						<label
							>Destination LGU *<select
								class="select mt-2 w-full"
								bind:value={selections[row.id]}
								required
								disabled={busy}
								><option value="">Choose LGU</option
								>{#each data.lgus.filter((item) => item.active) as item (item.id)}<option
										value={item.id}>{item.name}</option
									>{/each}</select
							></label
						>
						<button class="btn btn-primary" disabled={busy || !selections[row.id]} type="submit"
							>Route {row.reference}</button
						>
					</form>{/if}
			</article>{:else}<p class="muted">No incidents waiting for routing review.</p>{/each}
		{#if total > unrouted.length}<p class="muted">
				Showing the first {unrouted.length}. Route these incidents and refresh to see the next
				group.
			</p>{/if}
	</section>
</div>

<style>
	fieldset {
		min-width: 0;
	}
	label,
	input,
	textarea,
	select {
		min-width: 0;
		max-width: 100%;
	}
	strong {
		overflow-wrap: anywhere;
	}
	.lgu-edit {
		max-width: 100%;
		height: auto;
		min-height: 44px;
		white-space: normal;
		overflow-wrap: anywhere;
		padding-block: 0.5rem;
	}
</style>
