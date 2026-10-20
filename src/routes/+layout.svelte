<script lang="ts">
	import favicon from '#lib/assets/favicon.svg';
	import { onMount } from 'svelte';
	import type { LayoutProps } from './$types';
	import './layout.css';

	let { children }: LayoutProps = $props();
	let hydrated = $state(false);
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

<div class="app-root" inert={!hydrated} aria-busy={!hydrated}>
	{@render children()}
</div>
