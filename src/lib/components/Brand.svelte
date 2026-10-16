<script lang="ts">
	import { resolve } from '$app/paths';
	import { HeartPulse } from '@lucide/svelte';
	let { inverse = false, compact = false }: { inverse?: boolean; compact?: boolean } = $props();
</script>

<a href={resolve('/')} class="brand" class:inverse aria-label="HandLink home">
	<span class="brand-symbol"><HeartPulse size={24} strokeWidth={1.8} aria-hidden="true" /></span>
	{#if !compact}<span>Hand<span class="brand-end">Link</span><span class="brand-dot">.</span></span
		>{/if}
</a>

<style>
	.brand {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		color: #20363b;
		font-size: 25px;
		font-weight: 750;
		letter-spacing: -1px;
		text-decoration: none;
	}
	.brand-symbol {
		display: grid;
		place-items: center;
		width: 39px;
		height: 39px;
		background: #16786c;
		color: white;
		border-radius: 12px;
	}
	.brand-end {
		font-weight: 450;
	}
	.brand-dot {
		color: #62b69a;
	}
	.inverse {
		color: white;
	}
	.inverse .brand-symbol {
		background: #30504e;
		color: #bde1d1;
	}
</style>
