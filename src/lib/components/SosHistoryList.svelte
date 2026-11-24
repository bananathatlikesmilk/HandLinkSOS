<script lang="ts">
	import { incidentStatusLabel, type IncidentSummary } from '#lib/incidents.ts';
	let { incidents }: { incidents: IncidentSummary[] } = $props();
	function displayTime(value: string) {
		return new Date(value).toLocaleString('en-PH', { timeZone: 'Asia/Manila' }) + ' PHT';
	}
</script>

<div class="sos-history-list">
	{#each incidents as incident (incident.id)}
		<article class="history-entry">
			<div class="entry-heading">
				<strong>{incident.personName}</strong>
				<span class="history-status" class:resolved={incident.status === 'Resolved'}>
					{incidentStatusLabel(incident)}
				</span>
			</div>
			<p class="user-copy">
				{incident.isStranger
					? 'SOS for a stranger'
					: incident.isForSomeoneElse
						? 'SOS for a trusted profile'
						: 'SOS for me'}
			</p>
			<p class="reference">Incident reference: {incident.reference}</p>
			<p class="user-copy">
				Sent: <time datetime={incident.startedAt}>{displayTime(incident.startedAt)}</time>
			</p>
			{#if incident.endedAt}
				<p class="user-copy">
					Closed: <time datetime={incident.endedAt}>{displayTime(incident.endedAt)}</time>
				</p>
			{/if}
			{#if incident.cancellationPending}
				<p class="user-copy">Cancellation requested · awaiting dispatcher review</p>
			{/if}
		</article>
	{/each}
</div>

<style>
	.history-entry {
		border-top: 1px solid var(--app-border);
		padding: 1rem 0;
		overflow-wrap: anywhere;
	}
	.entry-heading {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		margin-bottom: 0.35rem;
	}
	.history-status {
		border: 1px solid var(--app-border);
		border-radius: 999px;
		padding: 0.25rem 0.65rem;
		background: var(--app-surface-alt);
		color: var(--app-text);
		font-size: 0.85rem;
	}
	.history-status.resolved {
		border-style: dashed;
	}
	.reference {
		color: var(--app-text);
		font-size: 0.9rem;
		margin: 0.35rem 0;
	}
</style>
