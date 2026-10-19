<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import {
		pushAvailable,
		getPushStatus,
		enablePush,
		disablePush,
		syncPushAccount
	} from '#lib/native/push.ts';
	let { disabled = false }: { disabled?: boolean } = $props();
	let native = $state(false);
	let configured = $state(false);
	let enabled = $state(false);
	let loading = $state(true);
	let busy = $state(false);
	let error = $state('');
	let statusError = $state('');
	let mounted = false;
	let generation = 0;
	let refresh = async () => {};
	onMount(() => {
		mounted = true;
		native = pushAvailable();
		let checking = false;
		refresh = async () => {
			if (!native || !mounted || document.hidden || checking || busy) return;
			checking = true;
			const account = page.data.account?.id;
			const version = generation;
			try {
				const status = await getPushStatus();
				if (!mounted || version !== generation || account !== page.data.account?.id) return;
				configured = status.configured;
				enabled = status.enabled;
				statusError = '';
			} catch (cause) {
				if (mounted && version === generation && account === page.data.account?.id)
					statusError =
						cause instanceof Error ? cause.message : 'Could not check phone notifications.';
			} finally {
				checking = false;
				if (mounted && version === generation) loading = false;
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
		if (busy || disabled || !native || !page.data.account || (enable && !configured)) return;
		const account = page.data.account.id;
		const version = ++generation;
		busy = true;
		error = '';
		statusError = '';
		try {
			if (enable) await enablePush();
			else await disablePush();
			if (!mounted || version !== generation || account !== page.data.account?.id) {
				await syncPushAccount(page.data.account?.id ?? null).catch(() => {});
				return;
			}
			enabled = enable;
		} catch (cause) {
			if (mounted && version === generation && account === page.data.account?.id)
				error =
					cause instanceof Error
						? cause.message
						: 'Could not update phone notifications. Check Android notification settings.';
		} finally {
			if (mounted && version === generation) {
				busy = false;
				void refresh();
			}
		}
	}
</script>

<svelte:document onvisibilitychange={() => void refresh()} />
<section class="user-panel mt-6 space-y-3" aria-labelledby="push-notifications-heading">
	<h2 id="push-notifications-heading">Phone notifications</h2>
	{#if native}
		<p class="user-copy text-sm">Receive alerts on this phone. Requires notification permission.</p>
		<p class="user-copy text-sm" role="status">
			{loading
				? 'Checking phone notifications…'
				: enabled
					? 'Phone notifications enabled.'
					: 'Phone notifications disabled.'}
		</p>
		{#if !loading && !configured}<p class="user-notice text-sm">
				Phone alerts unavailable. Check in-app Notifications.
			</p>{/if}
		<button
			class="btn w-full btn-outline"
			disabled={disabled || busy || loading || (!configured && !enabled)}
			onclick={() => void change(!enabled)}
		>
			{busy
				? 'Updating notifications…'
				: enabled
					? 'Disable phone notifications'
					: 'Enable phone notifications'}
		</button>
		<p class="user-copy text-sm">
			Battery settings or force-stopping can block alerts. Check HandLink for saved updates.
		</p>
	{:else}
		<p class="user-copy text-sm">
			Phone alerts require the Android app. Use Notifications for saved updates.
		</p>
	{/if}
	{#if error || statusError}<p class="user-error text-sm" role="alert">{error || statusError}</p>
		<button
			class="btn btn-outline btn-sm"
			disabled={busy || disabled}
			onclick={() => {
				error = '';
				statusError = '';
				void refresh();
			}}>Check notification status</button
		>
	{/if}
</section>
