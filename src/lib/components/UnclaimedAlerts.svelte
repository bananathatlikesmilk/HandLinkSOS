<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { BellRing, Volume2 } from '@lucide/svelte';
	import { apiRequest, ApiRequestError } from '#lib/client/request.ts';
	import { unclaimedWait, type UnclaimedSummary } from '#lib/unclaimed.ts';

	let { onOpen }: { onOpen: (id: string) => Promise<void> } = $props();
	let snapshot = $state<UnclaimedSummary | null>(null);
	let error = $state('');
	let soundError = $state('');
	let soundEnabled = $state(false);
	let enabling = $state(false);
	let acknowledgedThrough = $state('0');
	let clock = $state(0);
	let receivedAt = $state(0);
	let audio: AudioContext | undefined;
	let controller: AbortController;
	let disposed = false;
	let refreshing = false;
	let lastSound = -Infinity;
	const needsAttention = $derived(
		!!snapshot?.count && BigInt(snapshot.newestReferenceNumber) > BigInt(acknowledgedThrough)
	);
	const fresh = $derived(!!snapshot && !error && clock - receivedAt <= 15000);
	const waited = $derived(
		snapshot?.oldest
			? unclaimedWait(
					Date.parse(snapshot.checkedAt) +
						clock -
						receivedAt -
						Date.parse(snapshot.oldest.startedAt)
				)
			: ''
	);

	function playWarning() {
		if (!soundEnabled || !needsAttention || !fresh || document.hidden || !audio || disposed) return;
		if (audio.state !== 'running') {
			soundEnabled = false;
			soundError = 'Sound was paused by your browser. Enable warning sound again.';
			return;
		}
		if (performance.now() - lastSound < 15000) return;
		try {
			const oscillator = audio.createOscillator();
			const gain = audio.createGain();
			const start = audio.currentTime;
			oscillator.type = 'sine';
			oscillator.frequency.setValueAtTime(880, start);
			gain.gain.setValueAtTime(0, start);
			gain.gain.linearRampToValueAtTime(0.12, start + 0.02);
			gain.gain.linearRampToValueAtTime(0, start + 0.35);
			oscillator.connect(gain);
			gain.connect(audio.destination);
			oscillator.onended = () => {
				oscillator.disconnect();
				gain.disconnect();
			};
			oscillator.start(start);
			oscillator.stop(start + 0.4);
			lastSound = performance.now();
		} catch {
			soundEnabled = false;
			soundError = 'Warning sound is unavailable. Keep the visual alert in view.';
		}
	}
	async function enableSound() {
		if (enabling) return;
		if (soundEnabled) {
			soundEnabled = false;
			return;
		}
		enabling = true;
		soundError = '';
		try {
			audio ??= new AudioContext();
			await audio.resume();
			if (disposed) return;
			if (audio.state !== 'running') throw new Error('Sound blocked');
			soundEnabled = true;
			lastSound = -Infinity;
			playWarning();
		} catch {
			soundError =
				'Your browser could not enable sound. Check its audio settings; visual warnings remain available.';
		} finally {
			enabling = false;
		}
	}
	async function refresh() {
		if (disposed || refreshing) return;
		refreshing = true;
		try {
			const result = await apiRequest<UnclaimedSummary>(resolve('/api/staff/incidents/unclaimed'), {
				signal: controller.signal
			});
			if (disposed) return;
			const previousNewest = snapshot?.newestReferenceNumber ?? '0';
			snapshot = result;
			receivedAt = performance.now();
			clock = receivedAt;
			error = '';
			if (
				BigInt(result.newestReferenceNumber) > BigInt(previousNewest) &&
				BigInt(result.newestReferenceNumber) > BigInt(acknowledgedThrough)
			)
				lastSound = -Infinity;
			playWarning();
		} catch (reason) {
			if (disposed) return;
			error = reason instanceof Error ? reason.message : 'Could not refresh unclaimed alerts.';
			if (reason instanceof ApiRequestError && [401, 403].includes(reason.status)) {
				snapshot = null;
				soundEnabled = false;
			}
		} finally {
			refreshing = false;
		}
	}
	onMount(() => {
		controller = new AbortController();
		void refresh();
		const tick = setInterval(() => {
			clock = performance.now();
			playWarning();
		}, 1000);
		const poll = setInterval(() => {
			if (!document.hidden) void refresh();
		}, 5000);
		const visible = () => {
			if (!document.hidden) void refresh();
		};
		document.addEventListener('visibilitychange', visible);
		return () => {
			disposed = true;
			controller.abort();
			clearInterval(tick);
			clearInterval(poll);
			document.removeEventListener('visibilitychange', visible);
			if (audio) void audio.close().catch(() => {});
		};
	});
</script>

<section
	class="unclaimed-panel"
	class:waiting={!!snapshot?.count}
	aria-label="Unclaimed SOS alerts"
>
	<div class="warning-heading">
		<BellRing size={23} aria-hidden="true" />
		<div>
			<h2 class="section-heading">Unclaimed SOS alerts</h2>
			<p role="status">
				{snapshot
					? `${snapshot.count} ${snapshot.count === 1 ? 'alert' : 'alerts'} waiting for a dispatcher`
					: error
						? 'Unclaimed alert status unavailable'
						: 'Checking unclaimed alerts…'}
			</p>
		</div>
	</div>
	{#if snapshot?.oldest}<div class="waiting-details">
			<strong>Oldest: {snapshot.oldest.reference}</strong><span class="wait-time"
				>Waiting {waited}</span
			>
			<button
				type="button"
				class="btn btn-outline btn-sm"
				onclick={() => snapshot?.oldest && onOpen(snapshot.oldest.id)}>View oldest alert</button
			>
		</div>{/if}
	{#if error}<p class="alert alert-error" role="alert">
			{error} Last loaded counts may be outdated. Sound is paused until refresh succeeds.<button
				class="btn btn-outline btn-sm"
				onclick={refresh}>Retry warning check</button
			>
		</p>{/if}
	{#if snapshot && !fresh && !error}<p class="muted" role="status">
			Waiting for a fresh queue check. Sound is paused.
		</p>{/if}
	<div class="warning-controls">
		<button
			type="button"
			class="btn btn-outline btn-sm"
			onclick={enableSound}
			disabled={enabling}
			aria-pressed={soundEnabled}
			><Volume2 size={17} aria-hidden="true" />{enabling
				? 'Enabling sound…'
				: soundEnabled
					? 'Mute warning sound'
					: 'Enable warning sound'}</button
		>
		{#if snapshot?.count}<button
				type="button"
				class="btn btn-outline btn-sm"
				disabled={!needsAttention || !fresh}
				onclick={() => {
					acknowledgedThrough = snapshot?.newestReferenceNumber ?? acknowledgedThrough;
				}}>Acknowledge warning</button
			>{/if}
	</div>
	{#if soundError}<p class="muted" role="status">{soundError}</p>{/if}
	<p class="muted warning-note">
		{needsAttention
			? soundEnabled
				? 'Sound repeats every 15 seconds while this page is visible.'
				: 'Enable sound for a reminder every 15 seconds while this page is visible.'
			: snapshot?.count
				? 'Warning acknowledged on this screen. These alerts still need a dispatcher.'
				: 'Covers your assigned queue across all filters and pages.'} Acknowledging does not claim an
		incident.
	</p>
	{#if snapshot}<p class="muted warning-note">
			All filters and pages included. Last checked: {new Date(
				snapshot.checkedAt
			).toLocaleTimeString()}
		</p>{/if}
</section>

<style>
	.unclaimed-panel {
		border: 1px solid var(--app-border);
		border-radius: 12px;
		padding: 1rem;
		display: grid;
		gap: 0.8rem;
		background: var(--app-surface);
		color: var(--app-text);
	}
	.waiting {
		border-left: 5px solid var(--app-danger);
		background: var(--app-surface-alt);
	}
	.warning-heading {
		display: flex;
		gap: 0.7rem;
		align-items: flex-start;
	}
	.warning-heading > :global(svg) {
		flex-shrink: 0;
		margin-top: 0.2rem;
		color: var(--app-danger);
	}
	.warning-heading p {
		margin-top: 0.3rem;
	}
	.waiting-details,
	.warning-controls {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		align-items: center;
	}
	.wait-time {
		font-variant-numeric: tabular-nums;
		font-weight: 700;
	}
	.warning-note {
		font-size: 0.8rem;
		line-height: 1.5;
	}
</style>
