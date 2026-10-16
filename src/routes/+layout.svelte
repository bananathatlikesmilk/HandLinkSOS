<script lang="ts">
	import favicon from '#lib/assets/favicon.svg';
	import type { LayoutProps } from './$types';
	import './layout.css';

	let { children }: LayoutProps = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<meta name="theme-color" content="#142d32" />
	<meta
		name="description"
		content="HandLink connects your safety circle, emergency information, and response team in one easy-to-use space."
	/>
</svelte:head>

{@render children()}
