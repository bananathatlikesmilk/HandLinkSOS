<script lang="ts">
	import { onMount, setContext, untrack } from 'svelte';
	import { page } from '$app/state';
	import { afterNavigate } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { Bell, ChevronLeft, Settings } from '@lucide/svelte';
	import { apiRequest } from '#lib/client/request.ts';
	import type { LocationNotification } from '#lib/notifications.ts';
	import { USER_PREVIEW, UserPreview } from '#lib/user/preview.svelte.ts';
	import UserBrand from '#lib/user/UserBrand.svelte';
	import LocationPublisher from '#lib/user/LocationPublisher.svelte';
	import type { LayoutProps } from './$types';
	let { children, data }: LayoutProps = $props();
	let unreadCount = $state(0);
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
<div class="user-preview" data-theme="handlink-user">
	<div class="user-device">
		{#if !welcome}<header class="user-header">
				<UserBrand />
				<div class="header-controls">
					{#if !authPage}<a
							class="btn btn-square btn-ghost"
							href={resolve('/user/notifications')}
							aria-label={unreadCount ? `Notifications, ${unreadCount} unread` : 'Notifications'}
						>
							<Bell size={20} strokeWidth={1.4} />{#if unreadCount > 0}<span
									class="notification-count">{unreadCount > 99 ? '99+' : unreadCount}</span
								>{/if}</a
						><a
							class="btn btn-square btn-ghost"
							href={resolve('/user/settings')}
							aria-label="Settings"><Settings size={23} strokeWidth={1.3} /></a
						>{/if}
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
				/>{/key}{/if}
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
		color: #d1d5c1;
	}
	.account-email {
		flex-basis: 100%;
	}
	.account-role {
		color: #e1ca79;
	}
	.header-controls .btn {
		position: relative;
	}
	.notification-count {
		position: absolute;
		right: 3px;
		top: 1px;
		font-size: 10px;
		min-width: 15px;
		height: 15px;
		border-radius: 50%;
		background: #e1ca79;
		color: #17180f;
		display: grid;
		place-items: center;
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
		color: #d6dac8;
	}
	.user-footer {
		padding: 35px 25px 23px;
		font-size: 11px;
		display: flex;
		justify-content: space-between;
		gap: 10px;
		color: #d1d5c1;
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
		color: #e1ca79;
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
