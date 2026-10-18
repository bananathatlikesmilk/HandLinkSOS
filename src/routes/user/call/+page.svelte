<script lang="ts">
	import { onDestroy } from 'svelte';
	import { afterNavigate } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { CircleCheck, Phone } from '@lucide/svelte';
	import {
		dialerHandoffKey,
		nativeDialerAvailable,
		openPhoneDialer,
		PHONE_DIALER_HREF
	} from '#lib/native/phone.ts';
	import type { PageProps } from './$types';
	let { data }: PageProps = $props();
	let native = $state(false);
	let opening = $state(false);
	let error = $state('');
	let notice = $state('');
	let disposed = false;
	async function openDialer() {
		if (opening || disposed) return;
		const accountId = data.account?.id;
		const incidentId = data.incident?.id;
		opening = true;
		error = '';
		notice = '';
		try {
			await openPhoneDialer();
			if (!disposed && data.account?.id === accountId && data.incident?.id === incidentId)
				notice = 'Phone dialer opened with 911 filled in. Tap Call to place the call.';
		} catch {
			if (!disposed && data.account?.id === accountId && data.incident?.id === incidentId)
				error = data.incident
					? 'Your SOS remains saved. The phone dialer could not open. Try again or open your Phone app yourself.'
					: 'The phone dialer could not open. Try again or open your Phone app yourself.';
		} finally {
			if (!disposed) opening = false;
		}
	}
	afterNavigate(() => {
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
		<p class="user-copy mt-3">Incident reference: {data.incident.reference}</p>
		<p class="user-copy mt-3">Status: {data.incident.status}</p>
	{:else}
		<h1 class="user-title">Call through your phone</h1>
	{/if}
	<p class="user-copy mt-4">
		HandLink sends SOS information to dispatchers. Calls use the dispatcher's separate phone system.
	</p>
	<p class="user-copy mt-4">
		Open your phone dialer with 911 filled in. You must tap Call to place the call. HandLink does
		not call automatically or connect the call.
	</p>
	{#if native}
		<button class="btn mt-6 w-full btn-primary" disabled={opening} onclick={openDialer}>
			<Phone size={19} aria-hidden="true" />
			{opening ? 'Opening phone dialer...' : 'Open phone dialer'}
		</button>
	{:else}
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- The phone URI opens an external protocol, not an app route. -->
		<a class="btn mt-6 w-full btn-primary" href={PHONE_DIALER_HREF}>
			<Phone size={19} aria-hidden="true" /> Open phone dialer
		</a>
		<p class="user-copy mt-3">
			Your device or browser may require a tap to open the Phone app. If this link does not work,
			open the Phone app yourself.
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
