<script lang="ts">
	import { resolve } from '$app/paths';
	import SosHistoryList from '#lib/components/SosHistoryList.svelte';
	import type { PageProps } from './$types';
	let { data }: PageProps = $props();
	const pages = $derived(Math.max(1, Math.ceil(data.total / data.pageSize)));
</script>

<svelte:head><title>Full SOS history · HandLink</title></svelte:head>

<div class="history-screen">
	<a class="btn btn-outline" href={resolve('/user/dashboard')}>Back to dashboard</a>
	<h1 class="user-title mt-6">Full SOS history</h1>
	<p class="user-copy mt-3">All SOS alerts you sent, newest first.</p>
	<section class="user-panel mt-6" aria-label="SOS history">
		<p class="user-copy mb-3">{data.total} {data.total === 1 ? 'alert' : 'alerts'} sent</p>
		{#if data.incidents.length}
			<SosHistoryList incidents={data.incidents} />
		{:else}
			<p class="user-copy">No SOS alerts sent yet.</p>
		{/if}
	</section>
	{#if pages > 1}
		<nav class="history-pages" aria-label="SOS history pages">
			{#if data.page > 1}
				<a class="btn btn-outline" href={resolve(`/user/history?page=${data.page - 1}`)}
					>Newer alerts</a
				>
			{/if}
			<p class="user-copy" aria-current="page">Page {data.page} of {pages}</p>
			{#if data.page < pages}
				<a class="btn btn-outline" href={resolve(`/user/history?page=${data.page + 1}`)}
					>Older alerts</a
				>
			{/if}
		</nav>
	{/if}
</div>

<style>
	.history-pages {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		margin-top: 1.5rem;
	}
</style>
