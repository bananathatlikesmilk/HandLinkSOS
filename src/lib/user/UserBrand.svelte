<script lang="ts">
	import { LockKeyhole } from '@lucide/svelte';
	import { asset, resolve } from '$app/paths';
	let { large = false }: { large?: boolean } = $props();
</script>

<a class="user-brand" class:large href={resolve('/user')} aria-label="HandLink User home">
	{#if large}
		<img src={asset('bee2.png')} alt="" width="3543" height="3543" />
	{:else}
		<img class="user-emblem" src={asset('logo.png')} alt="" width="3543" height="3543" />
		<span>HandLink</span><LockKeyhole size={18} strokeWidth={1.1} aria-hidden="true" />
	{/if}
</a>

<style>
	.user-brand {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		color: var(--app-text, #e4e3dc);
		font-size: 19px;
		letter-spacing: 1px;
		font-weight: 300;
		text-decoration: none;
	}
	.user-emblem {
		display: block;
		width: 22px;
		height: 26px;
		flex-shrink: 0;
		margin-right: 3px;
		object-fit: contain;
		mix-blend-mode: screen;
	}
	.large {
		display: block;
		width: min(240px, calc(100vw - 72px));
		max-width: 100%;
		min-width: 0;
		aspect-ratio: 1;
	}
	:global([data-appearance='light']) .user-emblem {
		mix-blend-mode: normal;
	}
	.large img {
		display: block;
		width: 100%;
		min-width: 0;
		height: 100%;
		object-fit: contain;
		mix-blend-mode: screen;
	}
</style>
