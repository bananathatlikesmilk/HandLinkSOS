<script lang="ts">
	import type { Snippet } from 'svelte';
	import { goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import {
		Home,
		Siren,
		FileText,
		LogOut,
		Menu,
		ShieldCheck,
		Sparkles,
		UserRound,
		Users,
		X
	} from '@lucide/svelte';
	import StaffBrand from './StaffBrand.svelte';
	import ThemeToggle from './ThemeToggle.svelte';
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
	let loggingOut = $state(false);
	let mobileOpen = $state(false);
	let drawer: HTMLDialogElement;
	const root = $derived(role === 'admin' ? ('/admin' as const) : ('/dispatch' as const));
	const links = $derived([
		...(role === 'admin'
			? [
					{ href: '/admin' as const, label: 'Dashboard', icon: Home },
					{ href: '/admin/alerts' as const, label: 'SOS alerts', icon: Siren }
				]
			: [{ href: '/dispatch' as const, label: 'SOS alerts', icon: Siren }]),
		{
			href: role === 'admin' ? ('/admin/reports' as const) : ('/dispatch/reports' as const),
			label: 'Incident reports',
			icon: FileText
		},
		...(role === 'admin'
			? [
					{ href: '/admin/accounts' as const, label: 'Manage accounts', icon: Users },
					{ href: '/admin/ai' as const, label: 'AI settings', icon: Sparkles }
				]
			: []),
		{
			href: role === 'admin' ? ('/admin/profile' as const) : ('/dispatch/profile' as const),
			label: 'My profile',
			icon: UserRound
		},
		{
			href: role === 'admin' ? ('/admin/security' as const) : ('/dispatch/security' as const),
			label: 'Account security',
			icon: ShieldCheck
		}
	]);
	function active(href: string) {
		return (
			page.url.pathname === href || (href !== root && page.url.pathname.startsWith(`${href}/`))
		);
	}
	function closeNavigation() {
		drawer?.close();
		mobileOpen = false;
	}
	async function logout() {
		if (loggingOut) return;
		loggingOut = true;
		logoutError = '';
		try {
			const response = await fetch('/api/auth/sign-out', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: '{}'
			});
			if (!response.ok) throw new Error('Sign-out failed');
			closeNavigation();
			await invalidateAll();
			await goto(resolve(role === 'admin' ? '/admin/login' : '/dispatch/login'));
		} catch {
			logoutError = 'Unable to log out. Try again.';
		} finally {
			loggingOut = false;
		}
	}
</script>

{#snippet navigation()}
	<nav aria-label="Main navigation">
		{#each links as link (link.href)}
			<a
				href={resolve(link.href)}
				class:active={active(link.href)}
				aria-current={active(link.href) ? 'page' : undefined}
				onclick={closeNavigation}
			>
				<link.icon size={22} aria-hidden="true" /><span>{link.label}</span>
			</a>
		{/each}
	</nav>
	{#if account}
		<section class="signed-in-account" aria-label="Signed-in account">
			<span class="account-label">Signed in as</span><strong>{account.name}</strong>
			<span class="account-email">{account.email}</span>
			<span class="account-role"
				>{account.role === 'admin'
					? 'Administrator'
					: account.role === 'dispatcher'
						? 'Dispatcher'
						: 'User'}</span
			>
		</section>
	{/if}
	<button type="button" class="logout-button" disabled={loggingOut} onclick={logout}>
		<LogOut size={22} aria-hidden="true" />{loggingOut ? 'Logging out...' : 'Log out'}
	</button>
	{#if logoutError}<p class="logout-error" role="alert">{logoutError}</p>{/if}
{/snippet}

<div class="handlink-staff staff-shell" data-theme="handlink-staff">
	<a href="#main-content" class="skip-link">Skip to content</a>
	<header class="staff-header">
		<StaffBrand href={root} />
		<span class="staff-role">{role === 'admin' ? 'Administrator' : 'Dispatcher'}</span>
		<div class="header-actions">
			<ThemeToggle />
			<button
				type="button"
				class="mobile-menu btn btn-outline"
				aria-label="Open navigation"
				aria-expanded={mobileOpen}
				aria-controls="staff-mobile-navigation"
				onclick={() => {
					drawer.showModal();
					mobileOpen = true;
				}}
			>
				<Menu size={22} aria-hidden="true" /><span>Menu</span>
			</button>
		</div>
	</header>
	<aside class="staff-sidebar" aria-label="Sidebar">{@render navigation()}</aside>
	<dialog
		{@attach (element) => {
			drawer = element;
		}}
		id="staff-mobile-navigation"
		class="staff-drawer"
		aria-labelledby="navigation-title"
		onclose={() => {
			mobileOpen = false;
		}}
	>
		<div class="drawer-heading">
			<h2 id="navigation-title">Navigation</h2>
			<button type="button" class="btn btn-ghost" onclick={closeNavigation}
				><X size={22} aria-hidden="true" />Close</button
			>
		</div>
		{@render navigation()}
	</dialog>
	<div class="staff-workspace">
		<main id="main-content" tabindex="-1" class="staff-content">{@render children()}</main>
		<footer class="staff-footer">
			HandLink | {role === 'admin' ? 'Administration' : 'Dispatcher workspace'}
		</footer>
	</div>
</div>

<style>
	.staff-shell {
		min-height: 100dvh;
		background: var(--app-bg);
		color: var(--app-text);
		--header-height: 88px;
		--sidebar-width: 260px;
	}
	.staff-header {
		position: fixed;
		inset: 0 0 auto;
		z-index: 40;
		min-height: var(--header-height);
		display: flex;
		align-items: center;
		gap: 20px;
		padding: 16px 28px;
		background: var(--app-surface);
		border-bottom: 1px solid var(--app-border);
	}
	.staff-role {
		color: var(--app-muted);
		font-size: 16px;
		border-left: 1px solid var(--app-border);
		padding-left: 20px;
	}
	.header-actions {
		margin-left: auto;
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.staff-sidebar {
		position: fixed;
		inset: var(--header-height) auto 0 0;
		z-index: 30;
		width: var(--sidebar-width);
		padding: 24px 16px;
		overflow-y: auto;
		background: var(--app-surface);
		border-right: 1px solid var(--app-border);
	}
	nav {
		display: grid;
		gap: 8px;
	}
	nav a,
	.logout-button {
		display: flex;
		align-items: center;
		gap: 12px;
		width: 100%;
		min-height: 52px;
		padding: 12px;
		border: 1px solid transparent;
		border-radius: 10px;
		font-size: 16px;
		font-weight: 600;
		color: var(--app-text);
		text-align: left;
		text-decoration: none;
	}
	nav a:hover,
	.logout-button:hover {
		background: var(--app-surface-alt);
		border-color: var(--app-border);
	}
	nav a.active {
		background: var(--app-accent);
		color: var(--app-accent-text);
	}
	.logout-button {
		margin-top: 16px;
		border-color: var(--app-border);
		background: transparent;
	}
	.logout-button:disabled {
		opacity: 0.6;
	}
	.signed-in-account {
		display: grid;
		gap: 4px;
		padding: 20px 12px 4px;
		margin-top: 24px;
		border-top: 1px solid var(--app-border);
		overflow-wrap: anywhere;
	}
	.account-label,
	.account-email,
	.account-role {
		color: var(--app-muted);
		font-size: 14px;
	}
	.logout-error {
		padding: 12px;
		color: var(--app-danger);
	}
	.staff-workspace {
		margin-left: var(--sidebar-width);
		padding-top: var(--header-height);
	}
	.staff-content {
		max-width: 1600px;
		margin: auto;
		padding: 32px;
		min-height: calc(100dvh - var(--header-height) - 64px);
		min-width: 0;
	}
	.staff-footer {
		padding: 20px 32px;
		color: var(--app-muted);
		font-size: 14px;
		border-top: 1px solid var(--app-border);
	}
	.mobile-menu {
		display: none;
	}
	.staff-drawer {
		position: fixed;
		inset: 0 auto 0 0;
		margin: 0;
		width: min(340px, 100%);
		max-width: 100%;
		max-height: 100dvh;
		height: 100dvh;
		padding: 20px;
		border: 0;
		background: var(--app-surface);
		color: var(--app-text);
		overflow-y: auto;
	}
	.staff-drawer::backdrop {
		background: #0009;
	}
	.drawer-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		margin-bottom: 20px;
	}
	.drawer-heading h2 {
		font-size: 20px;
		font-weight: 700;
	}
	@media (max-width: 1000px) {
		.staff-header {
			padding: 14px 18px;
			gap: 12px;
		}
		.staff-role {
			display: none;
		}
		.staff-sidebar {
			display: none;
		}
		.mobile-menu {
			display: inline-flex;
		}
		.staff-workspace {
			margin-left: 0;
		}
		.staff-content {
			padding: 24px 18px;
		}
	}
	@media (max-width: 520px) {
		.staff-shell {
			--header-height: 144px;
		}
		.staff-header {
			flex-wrap: wrap;
		}
		.header-actions {
			width: 100%;
			margin-left: 0;
			justify-content: space-between;
		}
	}
</style>
