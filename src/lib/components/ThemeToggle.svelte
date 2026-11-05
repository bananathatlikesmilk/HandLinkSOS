<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { Moon, Sun } from '@lucide/svelte';
	let appearance = $state<'light' | 'dark'>('dark');
	let transitionTimer: ReturnType<typeof setTimeout> | undefined;
	let revealing = $state(false);
	let activeTransition: ViewTransition | undefined;
	let revision = 0;
	let disposed = false;
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
			) {
				revision++;
				activeTransition?.skipTransition();
				apply(event.newValue, true);
			}
		};
		window.addEventListener('storage', synchronize);
		return () => {
			disposed = true;
			revision++;
			activeTransition?.skipTransition();
			delete document.documentElement.dataset.appearanceReveal;
			window.removeEventListener('storage', synchronize);
			clearTimeout(transitionTimer);
			delete document.documentElement.dataset.appearanceTransition;
		};
	});
	async function toggle(event: MouseEvent) {
		if (revealing) return;
		const value = appearance === 'dark' ? 'light' : 'dark';
		const currentRevision = ++revision;
		try {
			localStorage.setItem('handlink:appearance', value);
		} catch {
			/* Keep the current-page choice. */
		}
		if (!document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) {
			apply(value, true);
			return;
		}
		const root = document.documentElement;
		const bounds = (event.currentTarget as HTMLButtonElement).getBoundingClientRect();
		const x = bounds.left + bounds.width / 2;
		const y = bounds.top + bounds.height / 2;
		const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
		root.style.setProperty('--theme-reveal-x', `${x}px`);
		root.style.setProperty('--theme-reveal-y', `${y}px`);
		root.style.setProperty('--theme-reveal-radius', `${radius}px`);
		root.dataset.appearanceReveal = '';
		revealing = true;
		try {
			activeTransition = document.startViewTransition(async () => {
				if (disposed || revision !== currentRevision) return;
				apply(value);
				await tick();
			});
			// A hidden document or interrupted transition can skip the animation without failing the theme change.
			void activeTransition.ready.catch(() => {});
			await activeTransition.finished;
		} catch {
			if (!disposed && revision === currentRevision) apply(value, true);
		} finally {
			delete root.dataset.appearanceReveal;
			root.style.removeProperty('--theme-reveal-x');
			root.style.removeProperty('--theme-reveal-y');
			root.style.removeProperty('--theme-reveal-radius');
			activeTransition = undefined;
			revealing = false;
		}
	}
</script>

<button
	type="button"
	class="theme-toggle btn btn-outline"
	onclick={toggle}
	disabled={revealing}
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
