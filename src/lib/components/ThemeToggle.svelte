<script lang="ts">
	import { onMount } from 'svelte';
	import { Moon, Sun } from '@lucide/svelte';
	let appearance = $state<'light' | 'dark'>('dark');
	let transitionTimer: ReturnType<typeof setTimeout> | undefined;
	function apply(value: 'light' | 'dark', animate = false) {
		const root = document.documentElement;
		clearTimeout(transitionTimer);
		if (
			animate &&
			root.dataset.appearance !== value &&
			!matchMedia('(prefers-reduced-motion: reduce)').matches
		) {
			root.dataset.appearanceTransition = '';
			transitionTimer = setTimeout(() => {
				delete root.dataset.appearanceTransition;
			}, 350);
		} else delete root.dataset.appearanceTransition;
		appearance = value;
		root.dataset.appearance = value;
		root.style.colorScheme = value;
	}
	onMount(() => {
		let saved: string | null = null;
		try {
			saved = localStorage.getItem('handlink:appearance');
		} catch {
			/* Storage is optional. */
		}
		apply(
			saved === 'light' || saved === 'dark'
				? saved
				: matchMedia('(prefers-color-scheme: light)').matches
					? 'light'
					: 'dark'
		);
		const synchronize = (event: StorageEvent) => {
			if (
				event.key === 'handlink:appearance' &&
				(event.newValue === 'light' || event.newValue === 'dark')
			)
				apply(event.newValue, true);
		};
		window.addEventListener('storage', synchronize);
		return () => {
			window.removeEventListener('storage', synchronize);
			clearTimeout(transitionTimer);
			delete document.documentElement.dataset.appearanceTransition;
		};
	});
	function toggle() {
		apply(appearance === 'dark' ? 'light' : 'dark', true);
		try {
			localStorage.setItem('handlink:appearance', appearance);
		} catch {
			/* Keep the current-page choice. */
		}
	}
</script>

<button
	type="button"
	class="theme-toggle btn btn-outline"
	onclick={toggle}
	aria-label={appearance === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
	title={appearance === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
>
	{#if appearance === 'dark'}
		<Sun size={20} aria-hidden="true" />
	{:else}
		<Moon size={20} aria-hidden="true" />
	{/if}
</button>

<style>
	.theme-toggle {
		width: 48px;
		min-height: 48px;
		flex-shrink: 0;
		padding: 0;
		border-radius: 50%;
	}
</style>
