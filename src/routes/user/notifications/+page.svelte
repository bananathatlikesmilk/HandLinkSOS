<script lang="ts">
	import { onMount } from 'svelte';
	import { afterNavigate } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { Bell, Check } from '@lucide/svelte';
	import { apiRequest, ApiRequestError } from '#lib/client/request.ts';
	import type { AppNotification } from '#lib/notifications.ts';
	import { getUserPreview } from '#lib/user/preview.svelte.ts';
	import type { PageProps } from './$types';
	let { data }: PageProps = $props();
	const preview = getUserPreview();
	let notifications = $state<AppNotification[]>([]);
	let currentPage = $state(1);
	let total = $state(0);
	let pageSize = $state(20);
	let loading = $state(true);
	let error = $state('');
	let notice = $state('');
	let lastUpdated = $state('');
	let announcement = $state('');
	let busy = $state('');
	let reasons = $state<Record<string, string>>({});
	let stopped = false;
	let accountId = '';
	let listRequest = $state<AbortController | null>(null);
	let actionRequest: AbortController | null = null;
	async function refresh() {
		const identity = data.account?.id ?? '';
		if (identity !== accountId) {
			listRequest?.abort();
			actionRequest?.abort();
			listRequest = null;
			accountId = identity;
			notifications = [];
			reasons = {};
			currentPage = 1;
			total = 0;
			notice = '';
			error = '';
		}
		if (stopped || document.hidden || !identity || listRequest) return;
		const controller = new AbortController();
		listRequest = controller;
		try {
			const result = await apiRequest<{
				notifications: AppNotification[];
				total: number;
				page: number;
				pageSize: number;
			}>(`/api/notifications?page=${currentPage}`, { signal: controller.signal });
			if (stopped || controller.signal.aborted || data.account?.id !== identity) return;
			if (
				lastUpdated &&
				result.notifications.some((item) => !notifications.some((old) => old.id === item.id))
			)
				announcement = 'New updates are available.';
			notifications = result.notifications;
			lastUpdated = new Date().toLocaleTimeString();
			total = result.total;
			pageSize = result.pageSize;
			currentPage = result.page;
			error = '';
		} catch (cause) {
			if (!stopped && !controller.signal.aborted) {
				if (cause instanceof ApiRequestError && (cause.status === 401 || cause.status === 403)) {
					notifications = [];
					reasons = {};
					total = 0;
					notice = '';
					actionRequest?.abort();
				}
				error = cause instanceof Error ? cause.message : 'Could not load notifications.';
			}
		} finally {
			if (listRequest === controller) listRequest = null;
			if (!stopped && !controller.signal.aborted) loading = false;
		}
	}
	async function act(item: AppNotification, cancellation: boolean) {
		if (busy || stopped) return;
		if (cancellation && item.type !== 'sos') return;
		const reason = (reasons[item.id] ?? '').trim();
		if (cancellation && (!reason || reason.length > 500)) {
			error = 'Enter a cancellation reason between 1 and 500 characters.';
			return;
		}
		busy = item.id;
		error = '';
		notice = '';
		const identity = data.account?.id;
		const controller = new AbortController();
		actionRequest = controller;
		try {
			await apiRequest(
				cancellation && item.type === 'sos'
					? `/api/incidents/${encodeURIComponent(item.incidentId)}/cancellation`
					: `/api/notifications/${encodeURIComponent(item.id)}/read`,
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(cancellation ? { reason } : {}),
					signal: controller.signal
				}
			);
			if (stopped || controller.signal.aborted || data.account?.id !== identity) return;
			notice = cancellation
				? 'Cancellation requested. The response stays active until the assigned dispatcher reviews your request.'
				: 'Notification marked as read.';
			listRequest?.abort();
			listRequest = null;
			await refresh();
			window.dispatchEvent(new Event('user-notifications-change'));
		} catch (cause) {
			if (!stopped && !controller.signal.aborted) {
				if (cause instanceof ApiRequestError && (cause.status === 401 || cause.status === 403)) {
					notifications = [];
					reasons = {};
					total = 0;
					notice = '';
					listRequest?.abort();
					listRequest = null;
				}
				error = cause instanceof Error ? cause.message : 'Could not save your request.';
			}
		} finally {
			if (actionRequest === controller) actionRequest = null;
			if (!stopped) busy = '';
		}
	}
	function changePage(next: number) {
		listRequest?.abort();
		listRequest = null;
		currentPage = next;
		loading = true;
		void refresh();
	}
	afterNavigate(() => {
		void refresh();
	});
	onMount(() => {
		void refresh();
		const interval = setInterval(refresh, 5000);
		document.addEventListener('visibilitychange', refresh);
		window.addEventListener('user-notifications-change', refresh);
		return () => {
			stopped = true;
			listRequest?.abort();
			actionRequest?.abort();
			clearInterval(interval);
			document.removeEventListener('visibilitychange', refresh);
			window.removeEventListener('user-notifications-change', refresh);
		};
	});
</script>

<svelte:head><title>Notifications — HandLink</title></svelte:head>
<section class="user-panel">
	<div class="flex items-center gap-3">
		<Bell size={25} />
		<h1 class="user-title">Notifications</h1>
	</div>
	<p class="user-copy mt-3">
		Updates refresh every 5 seconds while visible. {#if lastUpdated}Last updated {lastUpdated}.{/if}
	</p>
	<div class="user-actions mt-4">
		<button
			type="button"
			class="btn btn-outline"
			disabled={!!listRequest || !!busy}
			onclick={() => void refresh()}>Refresh updates</button
		><a class="btn btn-outline" href={resolve('/user/settings')}>Phone notification settings</a>
	</div>
	<p class="sr-only" role="status">{announcement}</p>
	{#if error}<p class="mt-4 alert alert-error" role="alert">{error}</p>{/if}
	{#if notice}<p class="mt-4 alert" role="status">{notice}</p>{/if}
	{#if loading}<p class="user-copy mt-5" role="status">
			Loading notifications…
		</p>{:else if notifications.length === 0}<p class="user-copy mt-5">
			No notifications yet.
		</p>{/if}
	<div class="notification-list" aria-busy={loading}>
		{#each notifications as item (item.id)}
			<article class="sos-notification" class:unread={!item.readAt}>
				<div class="flex flex-wrap items-center justify-between gap-2">
					<h2>
						{#if item.type === 'sos'}
							{item.callerName} sent an SOS for you
						{:else if item.type === 'location_shared'}
							{item.ownerName} shared their location with you
						{:else if item.type === 'location_expiring'}
							{item.isOwner
								? 'Your location-sharing reminder'
								: `${item.ownerName}'s location-sharing reminder`}
						{:else}
							{item.ownerName}'s location timer ended
						{/if}
					</h2>
					{#if !item.readAt}<span class="badge badge-outline">Unread</span>{/if}
				</div>
				{#if item.type === 'sos'}
					<p class="user-copy mt-2">Status: <strong>{item.status}</strong></p>
				{:else if item.type === 'location_expiring'}
					{#if item.sessionStatus === 'active' && Date.parse(item.expiresAt) > preview.clock}
						{#if item.isOwner}
							<p class="user-copy mt-2">Your location sharing ends in less than a minute.</p>
							<a class="btn mt-3 btn-outline" href={resolve('/user/sharing')}>
								Manage location sharing
							</a>
						{:else}
							<p class="user-copy mt-2">
								{item.ownerName}'s location sharing ends in less than a minute.
							</p>
							<a
								class="btn mt-3 btn-outline"
								href={resolve(`/user/sharing/view?id=${encodeURIComponent(item.sessionId)}`)}
							>
								View location
							</a>
						{/if}
					{:else}
						<p class="user-copy mt-2">
							This reminder was sent one minute before {item.isOwner ? 'your' : 'their'} location-sharing
							timer ended. This location sharing is no longer active.
						</p>
					{/if}
				{:else if item.type === 'location_expired'}
					<p class="user-copy mt-2">
						{item.isOwner
							? 'Your location-sharing timer ended.'
							: 'Their location-sharing timer ended.'}
						Location sharing has stopped. Timer expiry does not automatically send an SOS.
					</p>
				{:else if item.sessionStatus === 'active'}
					<a
						class="btn mt-3 btn-outline"
						href={resolve(`/user/sharing/view?id=${encodeURIComponent(item.sessionId)}`)}
					>
						View location
					</a>
				{:else}
					<p class="user-copy mt-2">
						{item.sessionStatus === 'expired'
							? 'This location-sharing timer ended.'
							: item.sessionStatus === 'cancelled'
								? 'This location sharing was stopped.'
								: 'This location sharing is no longer available.'}
					</p>
				{/if}
				<p class="notification-date">
					<time datetime={item.createdAt}>{new Date(item.createdAt).toLocaleString()}</time>
				</p>
				{#if item.type === 'sos'}
					<p class="incident-id">Incident reference: {item.incidentReference}</p>
					{#if item.cancellation}
						<div class="cancellation-result" role="status">
							<strong
								>{item.cancellation.decision === 'pending'
									? 'Awaiting dispatcher review'
									: item.cancellation.decision === 'approved'
										? 'Cancellation approved'
										: 'Cancellation rejected'}</strong
							>
							<p class="mt-2">Reason: {item.cancellation.reason}</p>
							{#if item.cancellation.decision === 'pending'}<p class="mt-2">
									The emergency response stays active until the assigned dispatcher reviews your
									request.
								</p>{/if}
						</div>
					{:else if item.status !== 'Resolved'}
						<form
							class="mt-4"
							onsubmit={(event) => {
								event.preventDefault();
								void act(item, true);
							}}
						>
							<label class="block" for={`cancel-${item.id}`}>Reason for cancellation</label>
							<textarea
								id={`cancel-${item.id}`}
								class="textarea-bordered textarea mt-2 w-full"
								bind:value={reasons[item.id]}
								required
								maxlength="500"
								rows="3"
								disabled={!!busy}></textarea>
							<p class="user-copy mt-2">
								This sends a request. It does not stop the emergency response.
							</p>
							<button class="btn mt-3 btn-outline" type="submit" disabled={!!busy}
								>Request cancellation</button
							>
						</form>
					{/if}
				{/if}
				{#if !item.readAt}<button
						class="btn mt-3 btn-ghost"
						disabled={!!busy}
						onclick={() => act(item, false)}><Check size={17} /> Mark as read</button
					>{/if}
			</article>
		{/each}
	</div>
	{#if total > pageSize || currentPage > 1}
		<nav
			class="mt-5 flex flex-wrap items-center justify-between gap-3"
			aria-label="Notifications pages"
		>
			<button
				class="btn btn-outline"
				disabled={loading || !!busy || currentPage <= 1}
				onclick={() => changePage(currentPage - 1)}>Previous</button
			>
			<span>Page {currentPage} of {Math.max(1, Math.ceil(total / pageSize))}</span>
			<button
				class="btn btn-outline"
				disabled={loading || !!busy || currentPage * pageSize >= total}
				onclick={() => changePage(currentPage + 1)}>Next</button
			>
		</nav>
	{/if}
</section>

<style>
	.notification-list {
		display: grid;
		gap: 18px;
		margin-top: 24px;
	}
	.sos-notification {
		border: 1px solid #61674f;
		border-radius: 12px;
		padding: 18px;
		overflow-wrap: anywhere;
	}
	.sos-notification.unread {
		border-color: #e1ca79;
	}
	h2 {
		font-size: 17px;
		font-weight: 600;
	}
	.notification-date,
	.incident-id {
		color: #d1d5c1;
		margin-top: 8px;
		font-size: 12px;
	}
	.cancellation-result {
		margin-top: 16px;
		padding: 14px;
		background: #ffffff0a;
		border-radius: 8px;
		font-size: 13px;
		line-height: 1.7;
	}
</style>
