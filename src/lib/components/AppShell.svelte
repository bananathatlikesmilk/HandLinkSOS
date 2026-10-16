<script lang="ts">
	import type { Snippet } from 'svelte';
	import { goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { Activity, FileText, LogOut, Menu, ShieldCheck, Users, X } from '@lucide/svelte';
	import StaffBrand from './StaffBrand.svelte';
	let {
		role = 'dispatch',
		account,
		children
	}: {
		role?: 'dispatch' | 'admin';
		account?: { name: string; email: string; role: 'user' | 'dispatcher' | 'admin' } | null;
		children: Snippet;
	} = $props();
	let logoutError = $state('');
	async function logout(event: MouseEvent) {
		event.preventDefault();
		const response = await fetch('/api/auth/sign-out', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: '{}'
		});
		if (!response.ok) {
			logoutError = 'Unable to log out. Try again.';
			return;
		}
		await invalidateAll();
		await goto(resolve(role === 'admin' ? '/admin/login' : '/dispatch/login'));
	}
	let mobileOpen = $state(false);
	const root = $derived(role === 'admin' ? ('/admin' as const) : ('/dispatch' as const));
	const links = $derived([
		{ href: root, label: role === 'admin' ? 'Active incidents' : 'SOS alerts', icon: Activity },
		{
			href: role === 'admin' ? ('/admin/reports' as const) : ('/dispatch/reports' as const),
			label: 'Incident reports',
			icon: FileText
		},
		...(role === 'admin'
			? [{ href: '/admin/accounts' as const, label: 'Manage accounts', icon: Users }]
			: []),
		{
			href: role === 'admin' ? ('/admin/security' as const) : ('/dispatch/security' as const),
			label: 'Account security',
			icon: ShieldCheck
		}
	]);
</script>

<div class="handlink-staff staff-shell" data-theme="handlink-staff">
	<a href="#main-content" class="skip-link">Skip to content</a>
	<header class="staff-header">
		<StaffBrand href={root} />
		<div class="staff-role">
			{role === 'admin' ? 'Administrator' : 'Dispatcher'}
		</div>
		<button
			class="mobile-menu btn btn-square btn-ghost"
			aria-label={mobileOpen ? 'Close navigation' : 'Open navigation'}
			aria-expanded={mobileOpen}
			aria-controls="staff-navigation"
			onclick={() => {
				mobileOpen = !mobileOpen;
			}}
			>{#if mobileOpen}<X size={22} />{:else}<Menu size={22} />{/if}</button
		>
		<nav id="staff-navigation" class:open={mobileOpen} aria-label="Main navigation">
			{#each links as link (link.href)}<a
					href={resolve(link.href)}
					class:active={page.url.pathname === link.href}
					aria-current={page.url.pathname === link.href ? 'page' : undefined}
					onclick={() => {
						mobileOpen = false;
					}}><link.icon size={17} aria-hidden="true" />{link.label}</a
				>{/each}
			<a href={resolve(role === 'admin' ? '/admin/login' : '/dispatch/login')} onclick={logout}
				><LogOut size={17} aria-hidden="true" />Log out</a
			>
		</nav>
	</header>
	{#if account}
		<section class="signed-in-account" aria-label="Signed-in account">
			<span class="account-label">Signed in as</span>
			<strong>{account.name}</strong>
			<span class="account-email">{account.email}</span>
			<span class="account-role">
				{account.role === 'admin'
					? 'Administrator'
					: account.role === 'dispatcher'
						? 'Dispatcher'
						: 'User'}
			</span>
		</section>
	{/if}
	<main id="main-content" tabindex="-1" class="staff-content">
		{#if logoutError}<p role="alert">{logoutError}</p>{/if}{@render children()}
	</main>
	<footer class="staff-footer">HandLink</footer>
</div>

<style>
	.staff-shell {
		min-height: 100dvh;
		background: #050505;
		color: #eeeeec;
	}
	.staff-header {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 24px;
		padding: 24px 4%;
		border-bottom: 1px solid #494949;
	}
	.staff-role {
		color: #c4c4c1;
		font-size: 13px;
		border-left: 1px solid #646464;
		padding-left: 24px;
	}
	.signed-in-account {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 6px 12px;
		padding: 14px 4%;
		border-bottom: 1px solid #373737;
		font-size: 13px;
		overflow-wrap: anywhere;
	}
	.signed-in-account > * {
		min-width: 0;
	}
	.account-label,
	.account-email {
		color: #c4c4c1;
	}
	.account-role {
		font-size: 12px;
		color: #eeeeec;
	}
	nav {
		margin-left: auto;
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	nav a {
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 44px;
		padding: 8px 16px;
		border: 1px solid transparent;
		border-radius: 999px;
		font-size: 14px;
		color: #dadad7;
	}
	nav a:hover {
		background: #242424;
	}
	nav a.active {
		background: #d1d1ce;
		color: #080808;
	}
	.staff-content {
		max-width: 1600px;
		margin: auto;
		padding: 32px 4%;
		min-height: calc(100dvh - 155px);
	}
	.staff-footer {
		padding: 20px 4%;
		color: #b7b7b3;
		font-size: 12px;
		border-top: 1px solid #373737;
	}
	.mobile-menu {
		display: none;
		margin-left: auto;
	}
	@media (max-width: 760px) {
		.staff-header {
			gap: 14px;
			padding: 18px 20px;
		}
		.staff-role {
			padding-left: 14px;
		}
		.mobile-menu {
			display: inline-flex;
		}
		nav {
			display: none;
			width: 100%;
			margin: 0;
		}
		nav.open {
			display: flex;
		}
		.staff-content {
			padding: 24px 18px;
		}
	}
	@media (max-width: 390px) {
		.staff-role {
			display: none;
		}
	}
</style>
