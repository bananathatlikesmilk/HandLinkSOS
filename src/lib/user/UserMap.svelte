<script lang="ts">
	let {
		latitude,
		longitude,
		name = 'Shared location'
	}: { latitude: number; longitude: number; name?: string } = $props();
	let loaded = $state(false);
	const valid = $derived(
		Number.isFinite(latitude) &&
			Math.abs(latitude) <= 90 &&
			Number.isFinite(longitude) &&
			Math.abs(longitude) <= 180
	);
	const embedUrl = $derived.by(() => {
		if (!valid) return '';
		const bounds = [
			Math.max(-180, longitude - 0.01),
			Math.max(-90, latitude - 0.01),
			Math.min(180, longitude + 0.01),
			Math.min(90, latitude + 0.01)
		];
		return `https://www.openstreetmap.org/export/embed.html?${new URLSearchParams({ bbox: bounds.join(','), layer: 'mapnik', marker: `${latitude},${longitude}` })}`;
	});
	const externalUrl = $derived(
		valid
			? `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=16/${latitude}/${longitude}`
			: ''
	);
</script>

{#if valid}
	<section class="user-panel space-y-4" aria-label="Shared location map">
		<p class="user-copy text-sm">
			Loading the map sends these viewed coordinates to OpenStreetMap, an external map provider.
		</p>
		{#if loaded}
			<iframe
				title={`Map of ${name}`}
				src={embedUrl}
				referrerpolicy="no-referrer"
				loading="lazy"
				class="h-72 w-full rounded-lg border-0"
			></iframe>
			<!-- eslint-disable svelte/no-navigation-without-resolve -- External OpenStreetMap URL, not an application route. -->
			<a
				class="btn w-full btn-outline"
				href={externalUrl}
				target="_blank"
				rel="noopener noreferrer"
				referrerpolicy="no-referrer">Open in OpenStreetMap</a
			>
			<!-- eslint-enable svelte/no-navigation-without-resolve -->
			<p class="user-copy text-xs">Map data © OpenStreetMap contributors.</p>
		{:else}
			<button type="button" class="btn w-full btn-outline" onclick={() => (loaded = true)}
				>Load map</button
			>
		{/if}
	</section>
{:else}
	<p class="user-notice">Map unavailable: no valid coordinates.</p>
{/if}
