<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { Clock3, MapPin } from '@lucide/svelte';
	import { apiRequest } from '#lib/client/request.ts';
	import type { SharedLocationSession } from '#lib/sharing.ts';
	import UserMap from '#lib/user/UserMap.svelte';
	let session = $state<SharedLocationSession | null>(null);
	let loadedKey = $state('');
	let loading = $state(true);
	let error = $state('');
	let now = $state(Date.now());
	const sessionId = $derived(page.url.searchParams.get('id') ?? '');
	const accountId = $derived(page.data.account?.id ?? '');
	const requestKey = $derived(`${accountId}:${sessionId}`);
	const share = $derived(
		loadedKey === requestKey && session?.status === 'active' && Date.parse(session.expiresAt) > now
			? session
			: null
	);
	const minutes = $derived(
		share?.point ? Math.max(0, Math.floor((now - Date.parse(share.point.recordedAt)) / 60000)) : 0
	);
	const stale = $derived(share?.point ? now - Date.parse(share.point.recordedAt) > 300000 : false);

	function startPolling() {
		const id = sessionId;
		const key = requestKey;
		session = null;
		loadedKey = key;
		loading = true;
		error = '';
		let stopped = false;
		let request: AbortController | null = null;
		async function refresh() {
			if (document.hidden || request || stopped) return;
			if (!id) {
				error = 'No sharing session selected.';
				loading = false;
				return;
			}
			const controller = new AbortController();
			request = controller;
			try {
				const result = await apiRequest<{ session: SharedLocationSession }>(
					`/api/sharing/${encodeURIComponent(id)}`,
					{ signal: controller.signal }
				);
				if (!stopped && !controller.signal.aborted) {
					session = result.session;
					error = '';
				}
			} catch (cause) {
				if (!stopped && !controller.signal.aborted) {
					session = null;
					error = cause instanceof Error ? cause.message : 'Could not load this shared location.';
				}
			} finally {
				if (!stopped && !controller.signal.aborted) loading = false;
				if (request === controller) request = null;
			}
		}
		function visibilityChanged() {
			if (document.hidden) {
				request?.abort();
				request = null;
				session = null;
			} else void refresh();
		}
		void refresh();
		const poll = setInterval(refresh, 5000);
		const clock = setInterval(() => (now = Date.now()), 1000);
		document.addEventListener('visibilitychange', visibilityChanged);
		return () => {
			stopped = true;
			request?.abort();
			clearInterval(poll);
			clearInterval(clock);
			document.removeEventListener('visibilitychange', visibilityChanged);
		};
	}
	$effect(startPolling);
</script>

<svelte:head><title>Shared location · HandLink</title></svelte:head>
{#if share}
	<div class="space-y-6">
		<div>
			<p class="user-kicker">SHARED WITH YOU</p>
			<h1 class="user-title mt-3">{share.ownerName}'s location</h1>
			<p class="user-copy mt-3">Sharing until {new Date(share.expiresAt).toLocaleString()}.</p>
		</div>
		{#if share.point}
			<UserMap
				latitude={share.point.latitude}
				longitude={share.point.longitude}
				name={share.ownerName}
			/>
			<div class="user-panel space-y-3">
				<p class="flex items-center gap-2 text-sm">
					<Clock3 size={17} />Last updated: {minutes === 0
						? 'just now'
						: `${minutes} minute${minutes === 1 ? '' : 's'} ago`}
				</p>
				<p class="user-copy text-sm">
					Recorded {new Date(share.point.recordedAt).toLocaleString()}. Estimated accuracy: {Math.round(
						share.point.accuracy
					)} meters.
				</p>
				<p class="flex items-center gap-2 text-sm">
					<MapPin size={16} />{Math.abs(share.point.latitude).toFixed(5)}° {share.point.latitude < 0
						? 'S'
						: 'N'}, {Math.abs(share.point.longitude).toFixed(5)}° {share.point.longitude < 0
						? 'W'
						: 'E'}
				</p>
				{#if stale}<p class="user-notice" role="status">
						Location may be out of date. Last update was more than five minutes ago.
					</p>{/if}
			</div>
		{:else}<p class="user-notice" role="status">
				Waiting for the sharer's first location update.
			</p>{/if}
		<p class="user-copy text-sm">
			Location is captured every five minutes while the sharer's app stays open. This page checks
			for updates every five seconds. Updates may pause when the app closes or loses connection.
		</p>
	</div>
{:else}
	<h1 class="user-title">{loading ? 'Loading shared location…' : 'Location unavailable'}</h1>
	<p class="user-copy mt-4" role="status">
		{error ||
			(loading
				? 'Checking your permission to view this location.'
				: 'Sharing ended, expired, or is no longer available to you.')}
	</p>
{/if}
<a class="btn mt-8 w-full btn-outline" href={resolve('/user/sharing/current')}
	>Back to currently sharing</a
>
