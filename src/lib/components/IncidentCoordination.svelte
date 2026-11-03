<script lang="ts">
	import type { IncidentDetail } from '#lib/incidents.ts';
	import { PROVINCIAL_LGU_ID, routingDescription } from '#lib/lgu.ts';
	import { apiRequest } from '#lib/client/request.ts';
	import IncidentLocation from './IncidentLocation.svelte';
	let {
		detail,
		lgus,
		disabled = false,
		onBusyChange,
		onAssigned
	}: {
		detail: IncidentDetail;
		lgus: { id: string; name: string }[];
		disabled?: boolean;
		onBusyChange: (value: boolean) => void;
		onAssigned: () => Promise<void>;
	} = $props();
	let destination = $state('');
	let verified = $state(false);
	let expectedLguId = $state<string | null>(null);
	let busy = $state(false);
	let error = $state('');
	async function assign(event: SubmitEvent) {
		event.preventDefault();
		if (busy || disabled || !destination || !verified) return;
		busy = true;
		error = '';
		onBusyChange(true);
		try {
			await apiRequest(`/api/staff/incidents/${encodeURIComponent(detail.incident.id)}/lgu`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					lguId: destination,
					expectedLguId,
					verballyConfirmed: verified
				})
			});
			verified = false;
		} catch (reason) {
			error =
				reason instanceof Error ? reason.message : 'Assignment failed. Refresh before retrying.';
		} finally {
			busy = false;
			onBusyChange(false);
			await onAssigned();
		}
	}
</script>

<section class="mb-6 space-y-4" aria-label="Provincial coordination">
	<h3 class="section-heading">Provincial coordination</h3>
	<p role="status">
		<strong
			>{detail.incident.provincialWorkflow
				? 'Provincial dispatcher keeps this case'
				: detail.incident.lguId === PROVINCIAL_LGU_ID
					? 'Awaiting provincial assignment'
					: detail.incident.dispatcherUserId
						? detail.incident.status === 'Resolved'
							? 'Response completed'
							: 'Accepted by municipal dispatch'
						: 'Awaiting municipal acceptance'}</strong
		>
	</p>
	{#if detail.incident.provincialWorkflow}
		<p>
			Calls use your office's existing system. Contact the municipality through its official hotline
			and relay only information needed for the emergency.
		</p>
		<p class="muted">
			Record contacts, acknowledgment, and additional details in incident notes. No caller profile
			is forwarded and no municipal acceptance happens in HandLink.
		</p>
	{/if}
	{#if detail.incident.provincialIntake}
		<p>
			GPS suggestion: <strong>{detail.incident.suggestedLguName ?? 'Needs location review'}</strong>
		</p>
		<p class="muted">
			{routingDescription(detail.incident.suggestionReason ?? '')}. Confirm the actual emergency
			location.
		</p>
	{/if}
	{#if detail.coordination}
		<IncidentLocation
			personLocation={detail.coordination.personLocation}
			reporter={detail.coordination}
			isForSomeoneElse={detail.incident.isForSomeoneElse}
		/>
		{#if detail.coordination.history.length}
			<h4 class="font-semibold">Assignment history</h4>
			<ul class="space-y-2">
				{#each detail.coordination.history as item (item.id)}
					<li>
						{item.destination} · {item.actorName} · {new Date(item.createdAt).toLocaleString()}
					</li>
				{/each}
			</ul>
		{/if}
	{/if}
	{#if !detail.incident.provincialWorkflow && detail.incident.status === 'Not assigned'}
		<form class="space-y-4" onsubmit={assign}>
			<label class="field-label"
				>Assign to municipality *
				<select class="select w-full" bind:value={destination} required disabled={disabled || busy}>
					<option value="" disabled>Choose municipality</option>
					{#each lgus as item (item.id)}<option value={item.id}
							>{item.name}{item.id === detail.incident.suggestedLguId
								? ' (GPS suggestion)'
								: ''}</option
						>{/each}
				</select>
			</label>
			<label class="flex items-start gap-3"
				><input
					type="checkbox"
					class="checkbox"
					bind:checked={verified}
					onchange={() => {
						expectedLguId = detail.incident.lguId;
					}}
					disabled={disabled || busy}
					required
				/>I confirmed the caller's name, phone number, and emergency location.</label
			>
			<button class="btn btn-primary" disabled={disabled || busy || !verified || !destination}
				>{busy ? 'Assigning…' : 'Assign to municipal dispatch'}</button
			>
			<p class="muted">
				Municipal dispatch must accept the incident. Contact them through your official response
				channels.
			</p>
		</form>
	{:else if !detail.incident.provincialWorkflow}
		<p class="muted">
			Municipal dispatch controls response updates. Provincial dispatch monitors the same case.
		</p>
	{/if}
	{#if detail.notes && !detail.personal}<div>
			<h4 class="font-semibold">Dispatcher notes</h4>
			<p class="whitespace-pre-wrap">{detail.notes}</p>
		</div>{/if}
	{#if error}<p class="alert alert-error" role="alert">{error}</p>{/if}
</section>
