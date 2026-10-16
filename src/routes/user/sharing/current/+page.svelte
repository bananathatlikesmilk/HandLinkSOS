<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { ArrowRight, MapPin, Users } from '@lucide/svelte';
	import { apiRequest } from '#lib/client/request.ts';
	import type { SharedLocationSession, SharingState } from '#lib/sharing.ts';
	let incoming = $state<SharedLocationSession[]>([]);
	let loadedAccount = $state('');
	let loading = $state(true);
	let error = $state('');
	let now = $state(Date.now());
	const accountId = $derived(page.data.account?.id ?? '');
	const active = $derived(
		loadedAccount === accountId
			? incoming.filter((share) => share.status === 'active' && Date.parse(share.expiresAt) > now)
			: []
	);

	function startPolling() {
		const id = accountId;
		incoming = [];
		loadedAccount = id;
		loading = true;
		error = '';
		let stopped = false;
		let request: AbortController | null = null;
		async function refresh() {
			if (document.hidden || request || stopped) return;
			const controller = new AbortController();
			request = controller;
			try {
				const result = await apiRequest<SharingState>('/api/sharing', {
					signal: controller.signal
				});
				if (!stopped && !controller.signal.aborted) {
					incoming = result.incoming;
					error = '';
				}
			} catch (cause) {
				if (!stopped && !controller.signal.aborted) {
					incoming = [];
					error = cause instanceof Error ? cause.message : 'Could not load shared locations.';
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
				incoming = [];
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

<svelte:head><title>Currently sharing · HandLink</title></svelte:head>
<h1 class="user-title">Currently sharing</h1>
<p class="user-copy mt-4">
	People sharing their location with you appear here until sharing stops or expires.
</p>
{#if error}<p class="user-notice mt-5" role="alert">{error}</p>{/if}
<div class="mt-8 grid gap-5" aria-busy={loading}>
	{#each active as share (share.id)}
		<article class="user-panel">
			<div class="flex items-center gap-3">
				<MapPin size={22} />
				<h2 class="text-lg font-medium">{share.ownerName}</h2>
			</div>
			<p class="user-copy mt-3 text-sm">
				Sharing until {new Date(share.expiresAt).toLocaleString()}.
			</p>
			<p class="user-copy mt-2 text-sm">
				{share.point
					? `Last updated: ${new Date(share.point.recordedAt).toLocaleString()}`
					: 'Waiting for a location update.'}
			</p>
			<a
				class="btn mt-5 w-full btn-outline"
				href={resolve(`/user/sharing/view?id=${encodeURIComponent(share.id)}`)}
				aria-label={`View ${share.ownerName}'s location`}>View location <ArrowRight size={16} /></a
			>
		</article>
	{:else}
		<div class="user-panel text-center">
			<Users size={32} class="mx-auto mb-4" />
			<p class="user-copy">
				{loading
					? 'Loading shared locations…'
					: error
						? 'Shared locations unavailable.'
						: 'Nobody is sharing a location with you right now.'}
			</p>
		</div>
	{/each}
</div>
<a class="btn mt-6 w-full btn-ghost" href={resolve('/user/sharing')}>Back to share location</a>
