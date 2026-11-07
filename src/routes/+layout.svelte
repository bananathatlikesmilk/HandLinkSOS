<script lang="ts">
	import favicon from '#lib/assets/favicon.svg';
	import { onMount } from 'svelte';
	import { navigating } from '$app/state';
	import type { LayoutProps } from './$types';
	import './layout.css';

	let { children }: LayoutProps = $props();
	let hydrated = $state(false);
	const loading = $derived(!hydrated || !!navigating.to);
	onMount(() => {
		hydrated = true;
		try {
			const saved = localStorage.getItem('handlink:appearance');
			const mode =
				saved === 'light' || saved === 'dark'
					? saved
					: matchMedia('(prefers-color-scheme: light)').matches
						? 'light'
						: 'dark';
			document.documentElement.dataset.appearance = mode;
			document.documentElement.style.colorScheme = mode;
		} catch {
			/* Theme preference is optional when browser storage is blocked. */
		}
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<meta name="theme-color" content="#142d32" />
	<meta
		name="description"
		content="HandLink connects your safety circle, emergency information, and response team in one easy-to-use space."
	/>
</svelte:head>

{#if loading}
	<div class="app-loading" role="status" aria-live="polite">
		<span class="app-loading-spinner" aria-hidden="true"></span>
		<span>Loading page…</span>
	</div>
{/if}

<div class="app-root" inert={!hydrated} aria-busy={loading}>
	{@render children()}
</div>
