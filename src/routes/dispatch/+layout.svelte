<script lang="ts">
	import { page } from '$app/state';
	import AppShell from '#lib/components/AppShell.svelte';
	import type { LayoutProps } from './$types';
	let { children, data }: LayoutProps = $props();
</script>

{#if page.url.pathname === '/dispatch/login' || page.url.pathname === '/dispatch/forgot-password'}
	{@render children()}
{:else}
	<AppShell
		role="dispatch"
		account={data.account && {
			name: data.account.name,
			email: data.account.email,
			role: data.account.role
		}}
		>{#if page.url.pathname === '/dispatch' || page.url.pathname === '/dispatch/security' || page.url.pathname === '/dispatch/reports'}
			{@render children()}
		{:else}<section class="panel">
				<h1 class="page-heading">Dispatcher workspace</h1>
				<p class="muted mt-4">
					This section is not connected yet. Open SOS alerts to handle incidents.
				</p>
			</section>{/if}</AppShell
	>
{/if}
