<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { apiRequest, ApiRequestError } from '#lib/client/request.ts';
	import type { SharingState } from '#lib/sharing.ts';
	import {
		getDeviceLocation,
		getNativeSharingStatus,
		disableNativeSharing
	} from '#lib/native/location.ts';
	let { accountId }: { accountId: string } = $props();
	let error = $state('');
	let refresh = () => {};
	onMount(() => {
		let stopped = false;
		let generation = 0;
		let busy = false;
		let request: AbortController | null = null;
		const initialAccount = accountId;
		async function publish() {
			if (stopped || busy || document.hidden || accountId !== initialAccount) return;
			busy = true;
			const version = generation;
			const controller = new AbortController();
			request = controller;
			const current = () =>
				!stopped &&
				generation === version &&
				!controller.signal.aborted &&
				!document.hidden &&
				accountId === initialAccount;
			try {
				const state = await apiRequest<SharingState>('/api/sharing', { signal: controller.signal });
				if (!current()) return;
				const session = state.own;
				if (
					!session ||
					session.status !== 'active' ||
					Date.parse(session.expiresAt) <= Date.now()
				) {
					await disableNativeSharing();
					error = '';
					return;
				}
				const native = await getNativeSharingStatus();
				if (!current()) return;
				if (native.active && native.sessionId === session.id) {
					error = '';
					return;
				}
				if (native.active) await disableNativeSharing();
				if (!current()) return;
				if (session.point && Date.now() - Date.parse(session.point.recordedAt) < 300000) {
					error = '';
					return;
				}
				const position = await getDeviceLocation();
				if (!current()) return;
				await apiRequest(`/api/sharing/${session.id}/points`, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					signal: controller.signal,
					body: JSON.stringify({
						latitude: position.coords.latitude,
						longitude: position.coords.longitude,
						accuracy: position.coords.accuracy,
						recordedAt: new Date(position.timestamp).toISOString()
					})
				});
				if (current()) error = '';
			} catch (cause) {
				if (!current()) return;
				if (cause instanceof ApiRequestError && (cause.status === 401 || cause.status === 403)) {
					await disableNativeSharing().catch(() => {});
					error = '';
					return;
				}
				if (cause instanceof ApiRequestError && cause.status === 429) {
					error = '';
					return;
				}
				error =
					'Location update failed. Sharing may still be active. Keep this app open and allow location, or stop sharing.';
			} finally {
				busy = false;
				if (request === controller) request = null;
				if (generation !== version && !stopped && !document.hidden) void publish();
			}
		}
		refresh = () => {
			generation++;
			request?.abort();
			if (!busy) void publish();
		};
		void publish();
		const sharingChanged = () => refresh();
		window.addEventListener('user-sharing-change', sharingChanged);
		const interval = setInterval(publish, 15000);
		return () => {
			stopped = true;
			// The user layout keys this component by account, so logout and account changes stop native updates.
			void disableNativeSharing().catch(() => {});
			generation++;
			request?.abort();
			clearInterval(interval);
			window.removeEventListener('user-sharing-change', sharingChanged);
			refresh = () => {};
		};
	});
</script>

<svelte:document onvisibilitychange={() => refresh()} />
{#if error}<aside class="mx-6 mt-4 rounded-lg border border-warning p-3 text-sm" role="status">
		{error} <a class="link" href={resolve('/user/sharing')}>Manage sharing</a>
	</aside>{/if}
