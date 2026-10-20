<script lang="ts">
	import { page } from '$app/state';
	import AppShell from '#lib/components/AppShell.svelte';
	import type { LayoutProps } from './$types';
	let { children, data }: LayoutProps = $props();
</script>

{#if page.url.pathname === '/admin/login' || page.url.pathname === '/admin/forgot-password'}
	{@render children()}
{:else}
	<AppShell
		role="admin"
		account={data.account && {
			name: data.account.name,
			email: data.account.email,
			role: data.account.role
		}}
		>{#if page.url.pathname === '/admin' || page.url.pathname === '/admin/alerts' || page.url.pathname === '/admin/accounts' || page.url.pathname === '/admin/security' || page.url.pathname === '/admin/reports' || page.url.pathname === '/admin/profile'}
			{@render children()}
		{:else}<section class="panel">
				<h1 class="page-heading">Admin workspace</h1>
				<p class="muted mt-4">
					This section is not connected yet. Open Active incidents to view the live queue.
				</p>
			</section>{/if}</AppShell
	>
{/if}
