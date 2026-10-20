<script lang="ts">
	import { onMount, setContext, untrack } from 'svelte';
	import { page } from '$app/state';
	import { afterNavigate } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { Bell, ChevronLeft, Home, Users, MapPin, Settings } from '@lucide/svelte';
	import ThemeToggle from '#lib/components/ThemeToggle.svelte';
	import { apiRequest } from '#lib/client/request.ts';
	import type { LocationNotification } from '#lib/notifications.ts';
	import { USER_PREVIEW, UserPreview } from '#lib/user/preview.svelte.ts';
	import UserBrand from '#lib/user/UserBrand.svelte';
	import LocationPublisher from '#lib/user/LocationPublisher.svelte';
	import UserPermissionStartup from '#lib/user/UserPermissionStartup.svelte';
	import { syncPushAccount } from '#lib/native/push.ts';
	import type { LayoutProps } from './$types';
	let { children, data }: LayoutProps = $props();
	let unreadCount = $state(0);
	const navigation = [
		{ href: '/user/dashboard', label: 'Home', icon: Home },
		{ href: '/user/profiles', label: 'Profiles', icon: Users },
		{ href: '/user/sharing', label: 'Location', icon: MapPin },
		{ href: '/user/notifications', label: 'Updates', icon: Bell },
		{ href: '/user/settings', label: 'Settings', icon: Settings }
	] as const;
	let locationWarning = $state<(LocationNotification & { accountId: string }) | null>(null);
	let refreshNotificationsOnNavigate = () => {};
	const preview = new UserPreview();
	const showLocationWarning = $derived(
		locationWarning?.accountId === data.account?.id &&
			locationWarning?.sessionStatus === 'active' &&
			new Date(locationWarning?.expiresAt ?? '').getTime() > preview.clock
	);
	setContext(USER_PREVIEW, preview);
	untrack(() => preview.loadAccount(data.accountProfile, !!data.account));
	afterNavigate(() => {
		preview.loadAccount(data.accountProfile, !!data.account);
		refreshNotificationsOnNavigate();
		// This also runs on mount. Permission prompts happen only through the settings opt-in button.
		void syncPushAccount(authPage ? null : (data.account?.id ?? null)).catch(() => {
			// Settings show delivery status and let the user retry without disrupting navigation.
		});
	});
	const authPage = $derived(
		[
			'/user',
			'/user/',
			'/user/login',
			'/user/register',
			'/user/verify',
			'/user/forgot-password',
			'/user/reset-password'
		].includes(page.url.pathname)
	);
	const dashboard = $derived(page.url.pathname === '/user/dashboard');
	const welcome = $derived(page.url.pathname === '/user' || page.url.pathname === '/user/');
	onMount(() => {
		preview.tick();
		let stopped = false;
		let accountId = '';
		let request: AbortController | null = null;
		async function refreshNotifications() {
			const currentId = authPage ? '' : (data.account?.id ?? '');
			if (currentId !== accountId) {
				request?.abort();
				request = null;
				accountId = currentId;
				unreadCount = 0;
				locationWarning = null;
			}
			if (!currentId || document.hidden || request || stopped) return;
			const controller = new AbortController();
			request = controller;
			try {
				const result = await apiRequest<{
					unreadCount: number;
					activeLocationWarning: LocationNotification | null;
				}>('/api/notifications?page=1', {
					signal: controller.signal
				});
				if (!stopped && !controller.signal.aborted && data.account?.id === currentId) {
					unreadCount = result.unreadCount;
					locationWarning = result.activeLocationWarning
						? { ...result.activeLocationWarning, accountId: currentId }
						: null;
				}
			} catch {
				if (!controller.signal.aborted && !stopped) {
					unreadCount = 0;
					locationWarning = null;
				}
			} finally {
				if (request === controller) request = null;
			}
		}
		function sharingChanged() {
			request?.abort();
			request = null;
			locationWarning = null;
			void refreshNotifications();
		}
		refreshNotificationsOnNavigate = () => {
			void refreshNotifications();
		};
		void refreshNotifications();
		const interval = setInterval(() => preview.tick(), 1000);
		const notificationsInterval = setInterval(refreshNotifications, 5000);
		document.addEventListener('visibilitychange', refreshNotifications);
		window.addEventListener('user-notifications-change', refreshNotifications);
		window.addEventListener('user-sharing-change', sharingChanged);
		return () => {
			stopped = true;
			void syncPushAccount(null).catch(() => {});
			refreshNotificationsOnNavigate = () => {};
			request?.abort();
			clearInterval(interval);
			clearInterval(notificationsInterval);
			document.removeEventListener('visibilitychange', refreshNotifications);
			window.removeEventListener('user-notifications-change', refreshNotifications);
			window.removeEventListener('user-sharing-change', sharingChanged);
		};
	});
</script>

<svelte:head><meta name="theme-color" content="#17180f" /></svelte:head>
<a href="#user-content" class="skip-link">Skip to User screen</a>
<div class="user-preview" class:has-navigation={!authPage} data-theme="handlink-user">
	{#if !authPage}
		<nav class="user-navigation" aria-label="Main navigation">
			{#each navigation as link (link.href)}
				<a
					href={resolve(link.href)}
					class:current={page.url.pathname.startsWith(link.href)}
					aria-current={page.url.pathname.startsWith(link.href) ? 'page' : undefined}
					aria-label={link.label === 'Updates' && unreadCount > 0
						? `Updates, ${unreadCount} unread`
						: link.label}
				>
					<span class="navigation-icon"
						><link.icon
							size={23}
							aria-hidden="true"
						/>{#if link.label === 'Updates' && unreadCount > 0}<span class="navigation-badge"
								>{unreadCount > 99 ? '99+' : unreadCount}</span
							>{/if}</span
					>
					<span>{link.label}</span>
				</a>
			{/each}
		</nav>
	{/if}
	<div class="user-device" class:with-navigation={!authPage}>
		{#if !welcome}<header class="user-header">
				<UserBrand />
				<div class="header-controls">
					<ThemeToggle />
				</div>
			</header>{/if}
		{#if data.account && !authPage}
			<section class="signed-in-account" aria-label="Signed-in account">
				<span class="account-label">Signed in as</span>
				<strong>{data.account.name}</strong>
				<span class="account-email">{data.account.email}</span>
				<span class="account-role">User</span>
			</section>
		{/if}
		{#if !authPage && !dashboard}<div class="user-back">
				<a href={resolve('/user/dashboard')}><ChevronLeft size={17} /> Dashboard</a>
			</div>{/if}
		{#if !authPage && unreadCount > 0}
			<a class="notification-banner" href={resolve('/user/notifications')}
				><Bell size={18} /> You have unread updates <span>({unreadCount})</span></a
			>
		{/if}
		{#if !authPage && showLocationWarning && locationWarning}
			<div class="sharing-warning" role="status" aria-atomic="true">
				<Bell size={20} aria-hidden="true" />
				<div>
					{#if locationWarning.isOwner}
						<strong>Your location sharing ends in less than a minute.</strong>
						<a href={resolve('/user/sharing')}>Manage location sharing</a>
					{:else}
						<strong
							>{locationWarning.ownerName}'s location sharing ends in less than a minute.</strong
						>
						<a
							href={resolve(
								`/user/sharing/view?id=${encodeURIComponent(locationWarning.sessionId)}`
							)}
						>
							View location
						</a>
					{/if}
				</div>
			</div>
		{/if}
		{#if data.account && !authPage}{#key data.account.id}<LocationPublisher
					accountId={data.account.id}
				/><UserPermissionStartup accountId={data.account.id} />{/key}{/if}
		<main id="user-content" tabindex="-1" class="user-content">
			{#key data.account?.id}{@render children()}{/key}
		</main>
		<footer class="user-footer">
			<span>HandLink</span><span>Your people. Within reach.</span>
		</footer>
	</div>
</div>

<style>
	.user-header {
		position: sticky;
		top: 0;
		z-index: 25;
		background: var(--app-surface, #17180f);
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 24px 24px 10px;
		min-height: 76px;
	}
	.header-controls {
		display: flex;
		align-items: center;
		gap: 5px;
	}
	.signed-in-account {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 5px 10px;
		margin: 8px 24px 0;
		padding: 12px 0;
		border-bottom: 1px solid #61674f;
		font-size: 12px;
		overflow-wrap: anywhere;
	}
	.signed-in-account > * {
		min-width: 0;
	}
	.account-label,
	.account-email {
		color: var(--app-muted);
	}
	.account-email {
		flex-basis: 100%;
	}
	.account-role {
		color: var(--app-accent);
	}
	.navigation-badge {
		position: absolute;
		right: -10px;
		top: -5px;
		font-size: 10px;
		min-width: 15px;
		height: 15px;
		border-radius: 50%;
		background: #e1ca79;
		color: #17180f;
		display: grid;
		place-items: center;
	}
	.user-navigation {
		position: fixed;
		z-index: 40;
		bottom: 0;
		inset-inline: 0;
		display: grid;
		grid-template-columns: repeat(5, minmax(0, 1fr));
		background: var(--app-surface, #17180f);
		color: var(--app-text);
		border-top: 1px solid var(--app-border);
		padding: 6px 4px max(6px, env(safe-area-inset-bottom));
	}
	.user-navigation a {
		display: flex;
		flex-direction: column;
		justify-content: center;
		align-items: center;
		gap: 5px;
		min-height: 58px;
		padding: 6px 2px;
		border-radius: 12px;
		color: var(--app-muted);
		font-size: 12px;
		font-weight: 600;
	}
	.user-navigation a.current {
		background: var(--app-accent);
		color: var(--app-accent-text);
	}
	.navigation-icon {
		position: relative;
	}
	.with-navigation {
		padding-bottom: 84px;
	}
	@media (min-width: 1100px) {
		.has-navigation {
			padding-left: 220px;
		}
		.user-navigation {
			top: 0;
			bottom: 0;
			right: auto;
			width: 220px;
			display: flex;
			flex-direction: column;
			padding: 100px 16px 24px;
			gap: 12px;
			border-right: 1px solid var(--app-border);
			border-top: 0;
		}
		.user-navigation a {
			flex-direction: row;
			justify-content: flex-start;
			padding: 14px 18px;
			gap: 14px;
			font-size: 16px;
		}
		.with-navigation {
			max-width: 900px;
			padding-bottom: 0;
		}
	}
	.user-back {
		padding: 14px 24px 0;
	}
	.user-back a {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		min-height: 44px;
		font-size: 13px;
		color: var(--app-text);
	}
	.user-footer {
		padding: 35px 25px 23px;
		font-size: 11px;
		display: flex;
		justify-content: space-between;
		gap: 10px;
		color: var(--app-muted);
		background: linear-gradient(0deg, #ffffff19, transparent);
	}
	.notification-banner {
		display: flex;
		align-items: center;
		gap: 8px;
		margin: 12px 24px;
		padding: 14px;
		border: 1px solid #e1ca79;
		border-radius: 10px;
		color: var(--app-accent);
		font-size: 13px;
	}
	.sharing-warning {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		margin: 12px 24px;
		padding: 16px;
		border: 1px solid #e1ca79;
		border-radius: 10px;
		background: #e1ca79;
		color: #17180f;
		font-size: 14px;
		line-height: 1.6;
	}
	.sharing-warning :global(svg) {
		flex-shrink: 0;
		margin-top: 2px;
	}
	.sharing-warning a {
		display: block;
		padding-block: 8px;
		text-decoration: underline;
		text-underline-offset: 3px;
	}
	@media (max-width: 390px) {
		.user-header {
			padding-inline: 20px;
		}
	}
</style>
