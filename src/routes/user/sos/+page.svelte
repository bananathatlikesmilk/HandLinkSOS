<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { CircleCheck, Siren, X } from '@lucide/svelte';
	import {
		incidentRequest,
		IncidentRequestError,
		readPendingSos,
		type PendingSos,
		type SosTarget
	} from '#lib/user/incidents-client.ts';
	import type { IncidentSummary } from '#lib/incidents.ts';
	import { getDeviceLocation } from '#lib/native/location.ts';
	import { dialerHandoffKey } from '#lib/native/phone.ts';
	import type { PageProps } from './$types';
	let { data }: PageProps = $props();
	let phase = $state<
		'loading' | 'locating' | 'countdown' | 'submitting' | 'sent' | 'cancelled' | 'error' | 'idle'
	>('loading');
	let target = $state<SosTarget | null>(null);
	let countdown = $state(5);
	let message = $state('');
	let recentError = $state('');
	let pending = $state<PendingSos | null>(null);
	let incident = $state<IncidentSummary | null>(null);
	let recent = $state<IncidentSummary[]>([]);
	let mounted = false;
	let controller: AbortController;
	let deadline = 0;
	let locatingAttempt = 0;
	let refreshing = false;
	const storageKey = $derived('handlink:sos:pending:' + (data.account?.id ?? ''));
	async function refreshRecent() {
		if (refreshing) return;
		refreshing = true;
		try {
			const result = await incidentRequest<{ incidents: IncidentSummary[] }>('/api/incidents', {
				signal: controller.signal
			});
			if (!mounted) return;
			recent = result.incidents;
			recentError = '';
			if (incident) incident = recent.find((item) => item.id === incident?.id) ?? incident;
		} catch (cause) {
			if (mounted)
				recentError = cause instanceof Error ? cause.message : 'Could not refresh alerts.';
		} finally {
			refreshing = false;
		}
	}
	function locate() {
		if (!mounted || !target || pending) return;
		const attempt = ++locatingAttempt;
		phase = 'locating';
		message = '';
		void getDeviceLocation().then(
			(position) => {
				if (!mounted || attempt !== locatingAttempt || phase !== 'locating' || !target) return;
				pending = {
					personProfileId: target.id,
					latitude: position.coords.latitude,
					longitude: position.coords.longitude,
					locationLabel: '',
					idempotencyKey: crypto.randomUUID()
				};
				countdown = 5;
				deadline = Date.now() + 5000;
				phase = 'countdown';
			},
			(failure) => {
				if (!mounted || attempt !== locatingAttempt || phase !== 'locating') return;
				phase = 'error';
				message =
					failure instanceof Error
						? failure.message
						: failure.code === 1
							? 'Location permission denied. Allow location in your browser settings, then retry.'
							: 'Could not get your location. Check location services, then retry.';
			}
		);
	}
	function cancel() {
		if (!['countdown', 'locating'].includes(phase)) return;
		locatingAttempt++;
		pending = null;
		phase = 'cancelled';
	}
	async function submit() {
		if (!mounted || !pending || phase === 'submitting') return;
		phase = 'submitting';
		message = '';
		try {
			// Save before sending so a lost response can safely retry the same request.
			sessionStorage.setItem(storageKey, JSON.stringify(pending));
			const result = await incidentRequest<{ incident: IncidentSummary }>('/api/incidents', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(pending),
				signal: controller.signal
			});
			if (!mounted) return;
			incident = result.incident;
			phase = 'sent';
			pending = null;
			try {
				sessionStorage.removeItem(storageKey);
			} catch {
				/* Server success remains authoritative. */
			}
			void refreshRecent();
			try {
				if (data.account)
					sessionStorage.setItem(dialerHandoffKey(data.account.id, result.incident.id), 'ready');
			} catch {
				/* The confirmed alert remains saved; the phone screen offers a manual handoff. */
			}
			try {
				await goto(resolve(`/user/call?incident=${encodeURIComponent(result.incident.id)}`), {
					replaceState: true
				});
			} catch {
				if (mounted) message = 'Your SOS was saved. Open the phone handoff below to continue.';
			}
		} catch (cause) {
			if (!mounted) return;
			phase = 'error';
			if (cause instanceof IncidentRequestError && cause.status >= 400 && cause.status < 500) {
				// A rejected request did not create an alert; allow a fresh countdown later.
				try {
					sessionStorage.removeItem(storageKey);
					pending = null;
				} catch {
					/* Retry retains the same key if storage is unavailable. */
				}
			}
			message =
				(cause instanceof Error ? cause.message : 'Could not confirm SOS delivery.') +
				(pending
					? ' Check recent alerts below. Retry uses the same request and cannot create a duplicate.'
					: ' Saved retry cleared. Existing alerts are not cancelled. Check recent alerts below before starting another SOS.');
			void refreshRecent();
		}
	}
	async function initialize() {
		try {
			pending = readPendingSos(storageKey);
			if (pending) {
				phase = 'error';
				message =
					'A previous SOS request has an unconfirmed result. Check recent alerts, or retry the saved request safely.';
			}
			const result = await incidentRequest<{ targets: SosTarget[] }>('/api/incidents/targets', {
				signal: controller.signal
			});
			if (!mounted) return;
			const id = pending?.personProfileId ?? page.url.searchParams.get('profile');
			target = result.targets.find((item) => item.id === id) ?? null;
			if (pending) return;
			if (target) locate();
			else {
				phase = 'idle';
				message = id
					? 'This profile is not available for SOS. Choose an approved profile from your dashboard.'
					: '';
			}
		} catch (cause) {
			if (mounted) {
				phase = 'error';
				message = cause instanceof Error ? cause.message : 'Could not prepare SOS.';
			}
		}
	}
	onMount(() => {
		mounted = true;
		controller = new AbortController();
		void initialize();
		void refreshRecent();
		const timer = setInterval(() => {
			if (phase === 'countdown') {
				countdown = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
				if (countdown === 0) void submit();
			}
		}, 100);
		const poll = setInterval(() => {
			if (!document.hidden) void refreshRecent();
		}, 5000);
		return () => {
			mounted = false;
			locatingAttempt++;
			controller.abort();
			clearInterval(timer);
			clearInterval(poll);
		};
	});
</script>

<svelte:head><title>SOS | HandLink</title></svelte:head>
<div class="sos-screen">
	{#if phase === 'loading'}
		<h1 class="user-title">Preparing SOS</h1>
		<p class="user-copy mt-4" role="status">Checking your saved profile...</p>
	{:else if phase === 'locating' || phase === 'countdown'}
		<p class="user-kicker">SOS FOR {target?.name}</p>
		<h1 class="user-title mt-4">You can still cancel</h1>
		<p class="user-copy mt-3">Your device location is sent with this SOS.</p>
		{#if phase === 'locating'}
			<p class="user-copy my-10" role="status">
				Getting your location. Allow location access to continue.
			</p>
		{:else}
			<div class="countdown-ring" role="timer" aria-label={countdown + ' seconds remaining'}>
				<Siren size={30} strokeWidth={1.2} /><strong>{countdown}</strong><span>SECONDS</span>
			</div>
		{/if}
		<button class="btn w-full btn-primary" onclick={cancel}><X size={18} /> Cancel SOS</button>
	{:else if phase === 'cancelled'}
		<CircleCheck size={60} strokeWidth={1.2} class="text-success" />
		<h1 class="user-title mt-6">SOS cancelled</h1>
		<p class="user-copy mt-4">No alert was sent from this countdown.</p>
	{:else if phase === 'submitting'}
		<Siren size={58} strokeWidth={1.2} />
		<h1 class="user-title mt-6">Sending SOS</h1>
		<p class="user-copy mt-4" role="status">
			Waiting for server confirmation. This alert can no longer be cancelled here.
		</p>
	{:else if phase === 'sent' && incident}
		<CircleCheck size={60} strokeWidth={1.2} class="text-success" />
		<h1 class="user-title mt-6">SOS sent</h1>
		<p class="user-copy mt-4">SOS for {incident.personName} was saved for dispatchers.</p>
		<p class="user-copy mt-4" role="status">Status: {incident.status}</p>
		<p class="user-copy mt-2 break-all">Incident reference: {incident.reference}</p>
		{#if message}<p class="user-copy mt-4" role="status">{message}</p>{/if}
		<a
			class="btn mt-6 w-full btn-primary"
			href={resolve(`/user/call?incident=${encodeURIComponent(incident.id)}`)}
		>
			Continue to phone
		</a>
		<p class="user-copy mt-5">
			This app does not place a call. Contact your local emergency service through your phone.
		</p>
	{:else if phase === 'error'}
		<h1 class="user-title">SOS needs attention</h1>
		<p class="user-error mt-4" role="alert">{message}</p>
		{#if pending}<button class="btn mt-6 w-full btn-primary" onclick={submit}
				>Retry saved SOS request</button
			>
		{:else if target}<button class="btn mt-6 w-full btn-primary" onclick={locate}
				>Retry location</button
			>
		{:else}<button class="btn mt-6 w-full btn-primary" onclick={initialize}
				>Retry preparation</button
			>{/if}
	{:else}
		<h1 class="user-title">No active SOS countdown</h1>
		<p class="user-copy mt-4">
			{message || 'Start SOS for yourself or an approved trusted profile from the dashboard.'}
		</p>
	{/if}
	<a class="btn mt-8 w-full btn-outline" href={resolve('/user/dashboard')}>Back to dashboard</a>
	<section class="user-panel mt-8 w-full space-y-3 text-left" aria-labelledby="sos-recent-heading">
		<h2 id="sos-recent-heading">Recent alerts you sent</h2>
		{#if recentError}<p class="user-error" role="status">{recentError}</p>
			<button class="btn btn-outline" onclick={refreshRecent}>Refresh alerts</button>{/if}
		{#each recent.slice(0, 5) as item (item.id)}
			<article class="border-t border-white/15 pt-3">
				<strong>{item.personName}</strong>
				<p class="user-copy">{item.status}</p>
				<p class="user-copy break-all">Incident reference: {item.reference}</p>
				<p class="user-copy">{new Date(item.startedAt).toLocaleString()}</p>
			</article>
		{:else}<p class="user-copy">No recent alerts loaded.</p>{/each}
	</section>
</div>

<style>
	.sos-screen {
		min-height: 580px;
		padding: 45px 6px 15px;
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
	}
	.countdown-ring {
		display: grid;
		place-items: center;
		gap: 6px;
		width: 210px;
		height: 210px;
		border: 2px solid #d4cfb1;
		border-radius: 50%;
		padding: 25px;
		margin: 45px 0;
	}
	.countdown-ring strong {
		font-size: 68px;
		line-height: 1;
		font-weight: 300;
	}
	.countdown-ring span {
		font-size: 11px;
		letter-spacing: 2px;
		color: #d2d6c3;
	}
</style>
