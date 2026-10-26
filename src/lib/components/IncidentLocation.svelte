<script lang="ts">
	import type { IncidentLocationSnapshot } from '#lib/incidents.ts';
	let {
		personLocation,
		reporter,
		isForSomeoneElse
	}: {
		personLocation: IncidentLocationSnapshot | null;
		reporter: { latitude: number; longitude: number; locationLabel: string };
		isForSomeoneElse: boolean;
	} = $props();
</script>

<section class="incident-location" aria-label="Incident location">
	{#if isForSomeoneElse}
		<h3>Location of person needing help</h3>
		{#if personLocation}
			<p>Last shared location saved when SOS was sent. This is not live tracking.</p>
			<dl>
				<div>
					<dt>Latitude / longitude</dt>
					<dd>{personLocation.latitude}, {personLocation.longitude}</dd>
				</div>
				<div>
					<dt>GPS accuracy</dt>
					<dd>Approximately {Math.round(personLocation.accuracy)} metres</dd>
				</div>
				<div>
					<dt>Location recorded</dt>
					<dd>
						<time datetime={personLocation.recordedAt}
							>{new Date(personLocation.recordedAt).toLocaleString()}</time
						>
					</dd>
				</div>
			</dl>
			<p>The person may have moved since this update. Confirm their current location.</p>
		{:else}
			<p>
				No shared location was available when SOS was sent. Do not assume the reporter is with this
				person.
			</p>
		{/if}
	{/if}
	<h3>{isForSomeoneElse ? 'Reporter’s device location' : 'Reported location'}</h3>
	<p>
		{reporter.latitude}, {reporter.longitude}{reporter.locationLabel
			? ` — ${reporter.locationLabel}`
			: ''}
	</p>
	{#if isForSomeoneElse}<p>
			These coordinates belong to the sender, not the person needing help.
		</p>{/if}
</section>

<style>
	.incident-location {
		display: grid;
		gap: 0.75rem;
		margin-block: 1.25rem;
		padding: 1rem;
		border: 1px solid var(--app-border);
		border-radius: 12px;
		background: var(--app-surface-alt);
		color: var(--app-text);
		overflow-wrap: anywhere;
	}
	h3 {
		margin: 0;
		font-size: 1rem;
		font-weight: 700;
	}
	p {
		margin: 0;
		line-height: 1.6;
	}
	dl {
		margin: 0;
		display: grid;
		gap: 0.75rem;
	}
	dt {
		font-weight: 600;
	}
	dd {
		margin: 0.25rem 0 0;
	}
</style>
