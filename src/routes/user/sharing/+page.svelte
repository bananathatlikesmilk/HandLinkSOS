<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { Clock3, MapPin, Users } from '@lucide/svelte';
	import { apiRequest, ApiRequestError } from '#lib/client/request.ts';
	import type { SharingState, SharedLocationSession } from '#lib/sharing.ts';
	import {
		getDeviceLocation,
		disableNativeSharing,
		nativeBackgroundAvailable
	} from '#lib/native/location.ts';
	import NativeSharingControls from '#lib/user/NativeSharingControls.svelte';
	let sharing = $state<SharingState | null>(null);
	let minutes = $state(15);
	let selected = $state<string[]>([]);
	let error = $state('');
	let busy = $state(false);
	let loading = $state(true);
	let now = $state(Date.now());
	let reload = async () => {};
	let cancelRead = () => {};
	let mutation: AbortController | null = null;
	let mounted = false;
	let generation = 0;
	type SessionResult = { session: SharedLocationSession };
	type StartPayload = {
		id: string;
		durationMinutes: number;
		recipientUserIds: string[];
		point: { latitude: number; longitude: number; accuracy: number; recordedAt: string };
	};
	let pending = $state<StartPayload | null>(null);
	const active = $derived(
		sharing?.own?.status === 'active' && Date.parse(sharing.own.expiresAt) > now
			? sharing.own
			: null
	);
	const remaining = $derived(
		active ? Math.max(0, Math.ceil((Date.parse(active.expiresAt) - now) / 1000)) : 0
	);
	const countdown = $derived(
		String(Math.floor(remaining / 60)).padStart(2, '0') +
			':' +
			String(remaining % 60).padStart(2, '0')
	);
	function changed() {
		window.dispatchEvent(new Event('user-sharing-change'));
	}
	function clearPrivate() {
		generation++;
		mutation?.abort();
		sharing = null;
		selected = [];
		pending = null;
		busy = false;
	}
	onMount(() => {
		mounted = true;
		let stopped = false;
		let account = page.data.account?.id;
		let request: AbortController | null = null;
		async function refresh(force = false) {
			if (account !== page.data.account?.id) {
				account = page.data.account?.id;
				request?.abort();
				request = null;
				clearPrivate();
			}
			if (stopped || document.hidden || request || !account || (busy && !force)) return;
			const owner = account;
			const controller = new AbortController();
			request = controller;
			try {
				const result = await apiRequest<SharingState>('/api/sharing', {
					signal: controller.signal
				});
				if (!stopped && !controller.signal.aborted && owner === page.data.account?.id) {
					sharing = result;
					loading = false;
				}
			} catch (cause) {
				if (controller.signal.aborted || stopped) return;
				if (cause instanceof ApiRequestError && [401, 403].includes(cause.status)) clearPrivate();
				error = cause instanceof Error ? cause.message : 'Could not load location sharing.';
				loading = false;
			} finally {
				if (request === controller) request = null;
			}
		}
		cancelRead = () => {
			request?.abort();
			request = null;
		};
		reload = () => refresh(true);
		void refresh();
		const poll = setInterval(() => refresh(), 5000);
		const timer = setInterval(() => (now = Date.now()), 1000);
		return () => {
			stopped = true;
			mounted = false;
			generation++;
			request?.abort();
			mutation?.abort();
			clearInterval(poll);
			clearInterval(timer);
			reload = async () => {};
		};
	});
	async function share(event: SubmitEvent) {
		event.preventDefault();
		if (busy) return;
		error = '';
		if (
			!pending &&
			(!Number.isInteger(minutes) ||
				minutes < 1 ||
				minutes > 240 ||
				selected.length < 1 ||
				selected.length > 20)
		) {
			error = 'Choose 1 to 20 recipients and a timer between 1 and 240 minutes.';
			return;
		}
		busy = true;
		cancelRead();
		const version = ++generation;
		const account = page.data.account?.id;
		const controller = new AbortController();
		mutation = controller;
		const current = () =>
			mounted &&
			version === generation &&
			account === page.data.account?.id &&
			!controller.signal.aborted;
		try {
			if (!pending) {
				const position = await getDeviceLocation();
				if (!current()) return;
				pending = {
					id: crypto.randomUUID(),
					durationMinutes: minutes,
					recipientUserIds: [...selected],
					point: {
						latitude: position.coords.latitude,
						longitude: position.coords.longitude,
						accuracy: position.coords.accuracy,
						recordedAt: new Date(position.timestamp).toISOString()
					}
				};
			}
			const result = await apiRequest<SessionResult>('/api/sharing', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(pending),
				signal: controller.signal
			});
			if (!current()) return;
			if (sharing) sharing.own = result.session;
			pending = null;
			changed();
			await reload();
		} catch (cause) {
			if (!current()) return;
			if (cause instanceof ApiRequestError && [401, 403].includes(cause.status)) clearPrivate();
			if (cause instanceof ApiRequestError && cause.status === 422) pending = null;
			error = cause instanceof Error ? cause.message : 'Allow location access and try again.';
			await reload();
			if (sharing?.own?.id === pending?.id && sharing?.own) {
				pending = null;
				error = '';
				changed();
			}
		} finally {
			if (current()) busy = false;
			if (mutation === controller) mutation = null;
		}
	}
	async function stop() {
		if (!active || busy) return;
		const id = active.id;
		cancelRead();
		const version = ++generation;
		const account = page.data.account?.id;
		const controller = new AbortController();
		mutation = controller;
		busy = true;
		error = '';
		changed();
		try {
			let nativeStopError = '';
			await disableNativeSharing().catch(() => {
				nativeStopError =
					'Could not confirm Android service stopped. Ended sessions cannot publish more locations.';
			});
			if (!mounted || version !== generation || account !== page.data.account?.id) return;
			const result = await apiRequest<SessionResult>('/api/sharing/' + id + '/stop', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: '{}',
				signal: controller.signal
			});
			if (!mounted || version !== generation || account !== page.data.account?.id) return;
			if (sharing) sharing.own = result.session;
			pending = null;
			changed();
			await reload();
			if (nativeStopError) error = nativeStopError;
		} catch (cause) {
			if (mounted && version === generation && !controller.signal.aborted) {
				if (cause instanceof ApiRequestError && [401, 403].includes(cause.status)) clearPrivate();
				error =
					(cause instanceof Error ? cause.message : 'Could not stop sharing. Please try again.') +
					' Sharing may still be active. Refresh and retry Stop sharing to end access.';
				await reload();
			}
		} finally {
			if (version === generation) busy = false;
			if (mutation === controller) mutation = null;
		}
	}
</script>

<svelte:document
	onvisibilitychange={() => {
		void reload();
	}}
/>
<svelte:head><title>Share location · HandLink</title></svelte:head>
<div class="sharing-screen">
	<h1 class="user-title text-center">Share location to your circle</h1>
	<p class="user-copy mt-4 text-center">
		Choose who can view your location and how long to share it.
	</p>
	<div class="sharing-symbol"><MapPin size={42} strokeWidth={1.1} /></div>
	{#if loading}<p class="user-copy mt-6" role="status">Loading location sharing…</p>
	{:else if active}
		<div class="sharing-active" role="status"><span></span>Location sharing active</div>
		<p class="time-left" role="timer" aria-label="Sharing time remaining">{countdown}</p>
		<p class="user-copy text-center">
			Sharing until {new Date(active.expiresAt).toLocaleTimeString()}
		</p>
		<ul class="mt-4 space-y-2" aria-label="Sharing recipients">
			{#each active.recipients as recipient (recipient.userId)}<li>{recipient.name}</li>{/each}
		</ul>
		{#if active.isOwner && page.data.account && nativeBackgroundAvailable()}
			{#key active.id + page.data.account.id}
				<NativeSharingControls session={active} accountId={page.data.account.id} disabled={busy} />
			{/key}
		{/if}
		<button class="btn mt-8 w-full btn-outline" onclick={stop} disabled={busy}
			>{busy ? 'Stopping…' : 'Stop sharing'}</button
		>
	{:else if sharing}
		{#if sharing.own?.status === 'expired'}<p class="user-notice mt-5" role="status">
				Your sharing timer ended. Location access has stopped.
			</p>{:else if sharing.own?.status === 'cancelled'}<p class="user-notice mt-5" role="status">
				Location sharing stopped.
			</p>{/if}
		<form class="mt-7 space-y-6" onsubmit={share}>
			<label class="user-field"
				>Set location sharing timer <span class="text-xs text-base-content/80"
					>Duration in minutes · 1 to 240</span
				><input
					class="input"
					type="number"
					min="1"
					max="240"
					step="1"
					required
					bind:value={minutes}
					disabled={busy || !!pending}
				/></label
			>
			<fieldset disabled={busy || !!pending} class="space-y-3">
				<legend class="mb-3 font-medium">Choose recipients</legend>
				{#each sharing.recipients as recipient (recipient.userId)}<label
						class="flex min-h-11 items-center gap-3"
						><input
							class="checkbox checkbox-sm"
							type="checkbox"
							value={recipient.userId}
							bind:group={selected}
						/><span
							>{recipient.name}<span class="block text-xs text-base-content/80"
								>{recipient.kind === 'both'
									? 'Trusted profile and emergency contact'
									: recipient.kind === 'trusted'
										? 'Trusted profile'
										: 'Emergency contact'}</span
							></span
						></label
					>{:else}<p class="user-copy">
						No eligible recipients. Add a trusted profile using QR approval first.
					</p>{/each}
			</fieldset>
			<p class="user-copy text-sm">
				Emergency contacts need a verified linked app account. If unavailable here, add them through
				QR approval.
			</p>
			<a class="link text-sm" href={resolve('/user/profiles')}>Manage trusted profiles</a>
			<button
				class="share-button btn w-full btn-outline"
				disabled={busy || !sharing.recipients.length}
				><MapPin size={17} />{busy
					? 'Starting sharing…'
					: pending
						? 'Retry sharing request'
						: 'Share location'}</button
			>
			{#if pending}<p class="user-copy text-sm">
					A request may have been saved. Retry checks the same request without creating a second
					session.
				</p>{/if}
		</form>
	{/if}
	{#if error}<p class="user-error mt-4" role="alert">{error}</p>
		<button
			type="button"
			class="btn mt-3 btn-outline btn-sm"
			onclick={() => {
				void reload();
			}}>Refresh sharing</button
		>{/if}
	<a class="btn mt-4 w-full btn-outline" href={resolve('/user/sharing/current')}
		><Users size={17} />Currently sharing</a
	>
	<div class="user-notice mt-5">
		<Clock3 size={18} />
		<p>
			Browser updates require this app to stay open and visible. In the Android app, explicitly
			enable screen-off updates to continue sharing with an ongoing notification. Updates occur
			about every five minutes. Timer expiry creates in-app notifications; incoming background push
			is not connected.
		</p>
	</div>
</div>

<style>
	.sharing-screen {
		padding: 13px 0;
	}
	.sharing-symbol {
		width: 98px;
		height: 98px;
		border-radius: 50%;
		border: 1px solid #7e8568;
		display: grid;
		place-items: center;
		margin: 28px auto 0;
		color: #e1ca79;
	}
	.sharing-screen .share-button {
		color: #e1ca79;
		border-color: #a48d4c;
	}
	.sharing-active {
		display: flex;
		justify-content: center;
		align-items: center;
		gap: 8px;
		margin-top: 30px;
		font-size: 14px;
		color: #d5e1c7;
	}
	.sharing-active > span {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: #a4d992;
	}
	.time-left {
		text-align: center;
		font-size: 49px;
		letter-spacing: 4px;
		font-weight: 300;
		margin: 15px 0;
	}
	.user-notice {
		display: flex;
		align-items: flex-start;
		gap: 10px;
	}
	.user-notice :global(svg) {
		flex-shrink: 0;
		margin-top: 3px;
	}
</style>
