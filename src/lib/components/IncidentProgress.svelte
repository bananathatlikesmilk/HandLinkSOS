<script lang="ts">
	import type { IncidentSummary, ResponseUpdate } from '#lib/incidents.ts';
	import { apiRequest } from '#lib/client/request.ts';
	let {
		incident,
		updates = [],
		canUpdate = false,
		disabled = false,
		beforeSave = async () => true,
		onBusyChange = () => {},
		onSaved = async () => {}
	}: {
		incident: IncidentSummary;
		updates?: ResponseUpdate[];
		canUpdate?: boolean;
		disabled?: boolean;
		beforeSave?: () => Promise<boolean>;
		onBusyChange?: (busy: boolean) => void;
		onSaved?: () => Promise<void>;
	} = $props();
	let status = $state<'' | 'On route' | 'Resolved'>('');
	let source = $state('');
	let details = $state('');
	let busy = $state(false);
	let error = $state('');
	async function save(event: SubmitEvent) {
		event.preventDefault();
		if (disabled || busy || !status || !source.trim() || !details.trim()) return;
		busy = true;
		error = '';
		let locked = false;
		try {
			if (!(await beforeSave()) || disabled) return;
			onBusyChange(true);
			locked = true;
			await apiRequest(`/api/staff/incidents/${encodeURIComponent(incident.id)}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ status, source: source.trim(), details: details.trim() })
			});
			status = '';
			source = '';
			details = '';
		} catch (reason) {
			error =
				reason instanceof Error
					? reason.message
					: 'Update could not be saved. Refresh before retrying.';
		} finally {
			busy = false;
			if (locked) {
				onBusyChange(false);
				await onSaved();
			}
		}
	}
</script>

<section class="my-5 space-y-4" aria-label="Confirmed response updates">
	<h3 class="section-heading">Confirmed response updates</h3>
	<p class="muted">
		Record updates received through official phone or radio channels. HandLink does not track
		responders automatically.
	</p>
	{#if updates.length}
		<p class="muted">
			Last recorded update: {new Date(updates[updates.length - 1].createdAt).toLocaleString()}
		</p>
		<ul class="space-y-4">
			{#each [...updates].reverse() as update (update.id)}
				<li class="border-b pb-3">
					<strong
						>{update.type === 'on_route'
							? 'On route'
							: update.type === 'cancellation_approved'
								? 'Cancellation approved'
								: 'Resolved'}</strong
					>
					<p class="muted">
						Recorded by {update.actorName} · {new Date(update.createdAt).toLocaleString()}
					</p>
					<p class="whitespace-pre-wrap">{update.notes}</p>
				</li>
			{/each}
		</ul>
	{:else}<p class="muted">No confirmed response updates recorded.</p>{/if}
	{#if canUpdate && incident.status !== 'Resolved'}
		<form class="space-y-4" onsubmit={save}>
			<fieldset class="space-y-4" disabled={disabled || busy}>
				<label class="field-label"
					>Confirmed status *<select class="select w-full" bind:value={status} required>
						<option value="" disabled>Choose confirmed status</option>
						<option value="On route" disabled={incident.status !== 'In progress'}
							>On route — departure confirmed</option
						>
						<option value="Resolved">Resolved — outcome confirmed</option>
					</select></label
				>
				<label class="field-label"
					>Update confirmed by *<input
						class="input w-full"
						bind:value={source}
						maxlength="150"
						required
						placeholder="Municipal office or responder name / unit"
					/></label
				>
				<label class="field-label"
					>Confirmed update / outcome *<textarea
						class="textarea min-h-28 w-full"
						bind:value={details}
						maxlength="1500"
						required
						placeholder="What they confirmed, including the outcome or reason no response was needed"
					></textarea></label
				>
				<p class="muted">
					A placed call does not mean help is on route. Resolve only after confirming the outcome.
				</p>
				<button class="btn btn-primary" disabled={!status || !source.trim() || !details.trim()}
					>{busy ? 'Saving…' : 'Save confirmed update'}</button
				>
			</fieldset>
		</form>
	{/if}
	{#if error}<p class="alert alert-error" role="alert">{error}</p>{/if}
</section>
