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
	let outcomeConfirmed = $state(false);
	function choose(value: 'On route' | 'Resolved') {
		if (disabled || busy || status === value) return;
		status = value;
		source = '';
		details = '';
		outcomeConfirmed = false;
		error = '';
	}
	const actionAllowed = $derived(
		status === 'On route'
			? incident.status === 'In progress'
			: status === 'Resolved' && incident.status === 'On route' && !incident.cancellationPending
	);
	async function save(event: SubmitEvent) {
		event.preventDefault();
		if (
			disabled ||
			busy ||
			!canUpdate ||
			!actionAllowed ||
			!source.trim() ||
			!details.trim() ||
			(status === 'Resolved' && !outcomeConfirmed)
		)
			return;
		busy = true;
		error = '';
		let locked = false;
		try {
			if (!(await beforeSave()) || disabled || !canUpdate || !actionAllowed) return;
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
			outcomeConfirmed = false;
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
		<div class="response-actions">
			<section class="response-action" aria-label="On route action">
				<h4>On route</h4>
				<p class="muted">Record confirmed responder departure. This keeps the incident open.</p>
				<button
					type="button"
					class="btn btn-outline"
					disabled={disabled || busy || incident.status !== 'In progress'}
					aria-expanded={status === 'On route'}
					onclick={() => choose('On route')}>Record departure</button
				>
			</section>
			<section class="response-action resolution-action" aria-label="Resolve incident action">
				<h4>Resolve incident</h4>
				<p class="muted">
					Close this incident only after confirming the final outcome. Original notes will be
					locked.
				</p>
				<button
					type="button"
					class="btn btn-outline"
					disabled={disabled ||
						busy ||
						incident.status !== 'On route' ||
						incident.cancellationPending}
					aria-expanded={status === 'Resolved'}
					onclick={() => choose('Resolved')}>Review resolution</button
				>
				{#if incident.cancellationPending}<p class="muted">
						Review the pending cancellation request first.
					</p>{/if}
				{#if incident.status !== 'On route'}<p class="muted">
						Record confirmed responder departure before resolving this incident.
					</p>{/if}
			</section>
		</div>
		{#if status}
			<form
				class="response-confirmation space-y-4"
				aria-label={status === 'On route'
					? 'Confirm responder departure'
					: 'Confirm incident resolution'}
				onsubmit={save}
			>
				<fieldset class="space-y-4" disabled={disabled || busy}>
					<h4>
						{status === 'On route' ? 'Confirm responder departure' : 'Confirm incident resolution'}
					</h4>
					<p class="muted">
						Incident: {incident.reference}. {status === 'On route'
							? 'This will mark responders as on route.'
							: 'This will close the incident and lock its original notes.'}
					</p>
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
					{#if status === 'Resolved'}<label class="resolution-check"
							><input type="checkbox" class="checkbox" required bind:checked={outcomeConfirmed} /> I confirmed
							the final outcome and intend to close this incident.</label
						>{/if}
					<button
						class="btn btn-primary"
						disabled={!actionAllowed ||
							!source.trim() ||
							!details.trim() ||
							(status === 'Resolved' && !outcomeConfirmed)}
						>{busy
							? 'Saving…'
							: status === 'On route'
								? 'Confirm and mark on route'
								: 'Confirm and mark resolved'}</button
					>
					<button
						type="button"
						class="btn btn-outline"
						onclick={() => {
							status = '';
							outcomeConfirmed = false;
						}}>Cancel status change</button
					>
				</fieldset>
			</form>
		{/if}
	{/if}
	{#if error}<p class="alert alert-error" role="alert">{error}</p>{/if}
</section>

<style>
	.response-actions {
		display: grid;
		gap: 1.75rem;
	}
	.response-action,
	.response-confirmation {
		padding: 1.1rem;
		border: 1px solid var(--app-border);
		border-radius: 12px;
		display: grid;
		gap: 0.85rem;
		background: var(--app-surface-alt);
	}
	.resolution-action {
		border-top: 4px solid var(--app-danger);
	}
	h4 {
		font-size: 1rem;
		font-weight: 700;
		margin: 0;
	}
	.resolution-check {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
		line-height: 1.6;
	}
	.resolution-check input {
		flex-shrink: 0;
		margin-top: 0.2rem;
	}
</style>
