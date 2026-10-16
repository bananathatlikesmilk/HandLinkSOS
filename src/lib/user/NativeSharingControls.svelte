<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import type { SharedLocationSession } from '#lib/sharing.ts';
	import {
		enableNativeSharing,
		disableNativeSharing,
		getNativeSharingStatus
	} from '#lib/native/location.ts';
	let {
		session,
		accountId,
		disabled = false
	}: { session: SharedLocationSession; accountId: string; disabled?: boolean } = $props();
	let active = $state(false);
	let busy = $state(false);
	let message = $state('Checking screen-off updates…');
	let error = $state('');
	let mounted = false;
	let generation = 0;
	let refresh = async () => {};
	const valid = () =>
		mounted &&
		!disabled &&
		page.data.account?.id === accountId &&
		session.isOwner &&
		session.status === 'active' &&
		Date.parse(session.expiresAt) > Date.now();
	onMount(() => {
		mounted = true;
		let checking = false;
		refresh = async () => {
			if (!valid() || document.hidden || checking || busy) return;
			checking = true;
			const version = generation;
			try {
				const status = await getNativeSharingStatus();
				if (!valid() || version !== generation) return;
				active = status.active && status.sessionId === session.id;
				message =
					status.message ||
					(active ? 'Screen-off updates enabled.' : 'Screen-off updates disabled.');
			} catch (cause) {
				if (valid() && version === generation)
					error =
						cause instanceof Error ? cause.message : 'Could not check Android location service.';
			} finally {
				checking = false;
			}
		};
		void refresh();
		const timer = setInterval(() => void refresh(), 5000);
		return () => {
			mounted = false;
			generation++;
			clearInterval(timer);
		};
	});
	async function change(enable: boolean) {
		if (!valid() || busy) return;
		busy = true;
		error = '';
		const version = ++generation;
		try {
			if (enable) await enableNativeSharing(session);
			else await disableNativeSharing();
			if (!valid() || version !== generation) {
				// A late permission result must not restart sharing after logout or expiry.
				if (enable) {
					const status = await getNativeSharingStatus();
					if (status.sessionId === session.id) await disableNativeSharing();
				}
				return;
			}
			active = enable;
			message = enable
				? 'Screen-off updates enabled.'
				: 'Screen-off updates disabled. Your sharing session remains active.';
		} catch (cause) {
			if (valid() && version === generation)
				error =
					cause instanceof Error
						? cause.message
						: 'Could not change screen-off updates. Check Android permissions.';
		} finally {
			if (mounted && version === generation) {
				busy = false;
				void refresh();
			}
		}
	}
</script>

<svelte:document onvisibilitychange={() => void refresh()} />
<section class="user-panel mt-5 space-y-3" aria-label="Android screen-off updates">
	<h2 class="font-medium">Android screen-off updates</h2>
	<p class="user-copy text-sm">
		Enable updates while the screen is off. Android requires an ongoing notification and location
		permission. Battery restrictions or force-stopping the app can interrupt updates.
	</p>
	<p class="user-copy text-sm" role="status">{message}</p>
	{#if error}<p class="user-error text-sm" role="alert">{error}</p>{/if}
	<button
		class="btn w-full btn-outline"
		disabled={busy || disabled}
		onclick={() => void change(!active)}
	>
		{busy
			? 'Updating Android service…'
			: active
				? 'Disable screen-off updates'
				: 'Enable screen-off updates'}
	</button>
	<p class="user-copy text-sm">
		Disabling screen-off updates keeps your sharing session active. Use Stop sharing to end access.
	</p>
</section>
