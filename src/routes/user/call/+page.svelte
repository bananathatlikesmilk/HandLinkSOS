<script lang="ts">
	import { onDestroy, onMount, untrack } from 'svelte';
	import { afterNavigate } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { CircleCheck, Phone } from '@lucide/svelte';
	import { dialerHandoffKey, nativeDialerAvailable, openPhoneDialer } from '#lib/native/phone.ts';
	import { phoneDialerHref, SOS_PHONE_PATTERN } from '#lib/emergency-phone.ts';
	import { apiRequest } from '#lib/client/request.ts';
	import type { PageProps } from './$types';
	let { data }: PageProps = $props();
	let phoneNumber = $state(untrack(() => data.phoneNumber));
	let native = $state(false);
	let opening = $state(false);
	let error = $state('');
	let notice = $state('');
	let disposed = false;
	let refreshVersion = 0;
	async function currentNumber() {
		const version = ++refreshVersion;
		const result = await apiRequest<{ number: string }>('/api/emergency-phone');
		if (!SOS_PHONE_PATTERN.test(result.number)) throw new Error('Invalid hotline response.');
		if (!disposed && version === refreshVersion) phoneNumber = result.number;
		return result.number;
	}
	onMount(() => {
		const refresh = () => {
			if (!opening && !document.hidden) void currentNumber().catch(() => {});
		};
		refresh();
		const timer = setInterval(refresh, 5000);
		window.addEventListener('focus', refresh);
		document.addEventListener('visibilitychange', refresh);
		return () => {
			clearInterval(timer);
			window.removeEventListener('focus', refresh);
			document.removeEventListener('visibilitychange', refresh);
		};
	});
	async function openDialer(event?: MouseEvent) {
		event?.preventDefault();
		if (opening || disposed) return;
		const accountId = data.account?.id;
		const incidentId = data.incident?.id;
		opening = true;
		error = '';
		notice = '';
		let refreshed = false;
		try {
			const number = await currentNumber();
			if (disposed || data.account?.id !== accountId || data.incident?.id !== incidentId) return;
			refreshed = true;
			if (!native) {
				// Only an explicit browser click may open an external dial screen.
				if (event) window.location.assign(phoneDialerHref(number));
				return;
			}
			await openPhoneDialer(number);
			if (!disposed && data.account?.id === accountId && data.incident?.id === incidentId)
				notice = `Phone dialer opened with ${number} filled in. Tap Call to place the call.`;
		} catch {
			if (!disposed && data.account?.id === accountId && data.incident?.id === incidentId)
				error = !refreshed
					? `${data.incident ? 'Your SOS remains saved. ' : ''}Could not verify the current hotline. Check your connection and retry. The last displayed number may be outdated.`
					: data.incident
						? `Your SOS remains saved. Open your Phone app and enter ${phoneNumber}. If this APK lacks custom-number support, update HandLink.`
						: `The phone dialer could not open. Open your Phone app and enter ${phoneNumber}. Update HandLink if custom-number support is missing.`;
		} finally {
			if (!disposed) opening = false;
		}
	}
	afterNavigate(() => {
		phoneNumber = data.phoneNumber;
		native = nativeDialerAvailable();
		if (!data.incident || !data.account || opening) return;
		const key = dialerHandoffKey(data.account.id, data.incident.id);
		try {
			if (sessionStorage.getItem(key) !== 'ready') return;
			sessionStorage.removeItem(key);
		} catch {
			notice = 'Tap Open phone dialer to continue.';
			return;
		}
		if (native && data.incident.status !== 'Resolved') void openDialer();
	});
	onDestroy(() => {
		disposed = true;
	});
</script>

<svelte:head><title>Contact emergency services | HandLink</title></svelte:head>
<div class="call-screen">
	<p class="user-kicker">EMERGENCY CALLS</p>
	<div class="dispatcher-avatar">
		{#if data.incident}<CircleCheck size={64} strokeWidth={1.1} />{:else}<Phone
				size={64}
				strokeWidth={1.1}
			/>{/if}
	</div>
	{#if data.incident}
		<h1 class="user-title">SOS sent</h1>
		<p class="user-copy mt-4">SOS for {data.incident.personName} was saved for dispatchers.</p>
		{#if data.incident.isStranger}<p class="user-copy mt-3">
				For an unregistered person. Tell the dispatcher what happened and confirm their location.
			</p>{/if}
		<p class="user-copy mt-3">Incident reference: {data.incident.reference}</p>
		<p class="user-copy mt-3">Status: {data.incident.status}</p>
		<p class="user-copy mt-3">LGU: {data.incident.lguName ?? 'Awaiting central routing review'}</p>
	{:else}
		<h1 class="user-title">Call through your phone</h1>
	{/if}
	<p class="user-copy mt-4">SOS shares information. Phone calls use a separate system.</p>
	<p class="user-copy mt-4">
		Open the dialer with {phoneNumber} ready. You must tap Call. HandLink never calls automatically.
	</p>
	{#if native}
		<button class="btn mt-6 w-full btn-primary" disabled={opening} onclick={openDialer}>
			<Phone size={19} aria-hidden="true" />
			{opening ? 'Opening phone dialer...' : 'Open phone dialer'}
		</button>
	{:else}
		<!-- eslint-disable svelte/no-navigation-without-resolve -- The Android intent opens an external dial screen, not an app route. -->
		<a
			class="btn mt-6 w-full btn-primary"
			href={phoneDialerHref(phoneNumber)}
			onclick={openDialer}
			aria-disabled={opening}
		>
			<Phone size={19} aria-hidden="true" /> Open phone dialer
		</a>
		<!-- eslint-enable svelte/no-navigation-without-resolve -->
		<p class="user-copy mt-3">
			Supported Android browsers only. Otherwise, open your Phone app and enter {phoneNumber}.
		</p>
	{/if}
	{#if error}<p class="user-error mt-4" role="alert">{error}</p>{/if}
	{#if notice}<p class="user-copy mt-4" role="status">{notice}</p>{/if}
	<a class="btn mt-8 w-full btn-outline" href={resolve('/user/dashboard')}>Back to dashboard</a>
</div>

<style>
	.call-screen {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		padding: 25px 5px;
		min-height: 550px;
	}
	.dispatcher-avatar {
		width: 150px;
		height: 150px;
		border-radius: 50%;
		border: 1px solid #838977;
		display: grid;
		place-items: center;
		margin: 35px 0;
		background: #25281b;
	}
</style>
