<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { page } from '$app/state';
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { ArrowLeft, ArrowRight, BookOpen, X } from '@lucide/svelte';

	const steps = [
		{
			title: 'Welcome to HandLink',
			text: 'A quick tour of the buttons that help you and your trusted people. This guide will not send an SOS or place a call.',
			target: ''
		},
		{
			title: 'SOS for me',
			text: 'This requests help for you. HandLink gathers your location, then gives you five seconds to cancel. The true-emergency option skips that countdown.',
			target: '.self-sos'
		},
		{
			title: 'Help someone else',
			text: 'Choose an approved trusted profile to request help for them. For a stranger, use the separate SOS button while you are at the scene.',
			target: '#trusted-title'
		},
		{
			title: 'You press Call',
			text: 'After an SOS is saved, HandLink opens or offers the hotline dialer. You must press Call yourself. HandLink does not answer or carry the call.',
			target: ''
		},
		{
			title: 'Manage your profiles',
			text: 'Keep your personal and medical details up to date here. Add trusted people and approve connections before requesting SOS for them.',
			target: '[data-tutorial="profiles"]'
		},
		{
			title: 'Share your location',
			text: 'Choose approved people and a sharing duration. You can stop sharing at any time. This is separate from sending an SOS.',
			target: '[data-tutorial="location"]'
		},
		{
			title: 'Check your updates',
			text: 'Read incident and location-sharing updates here. Opening the updates marks them as read.',
			target: '[data-tutorial="updates"]'
		},
		{
			title: 'Settings and permissions',
			text: 'Review location, camera and notification access here, or replay this tutorial. The moon/sun icon changes appearance.',
			target: '[data-tutorial="settings"]'
		},
		{
			title: 'Find your SOS history',
			text: 'Your five newest alerts appear here. View full history shows all alerts you sent, including requests for other people.',
			target: '.history-heading'
		}
	];
	let dialog: HTMLDialogElement;
	let heading: HTMLHeadingElement;
	let active = $state(false);
	let index = $state(0);
	let saving = $state(false);
	let warning = $state('');
	let rect = $state<{ left: number; top: number; width: number; height: number } | null>(null);
	let cardAtTop = $state(false);
	const step = $derived(steps[index]);
	let target: HTMLElement | null = null;
	let observer: ResizeObserver | undefined;
	let frame = 0;
	let stopped = false;
	const replay = page.url.searchParams.get('tutorial') === 'replay';
	const accountId = page.data.account?.id;
	const shouldStart = !page.data.tutorialSeen || replay;

	function measure() {
		if (!active || !target?.isConnected) {
			rect = null;
			return;
		}
		const bounds = target.getBoundingClientRect();
		const left = Math.max(6, bounds.left - 5);
		const top = Math.max(6, bounds.top - 5);
		const right = Math.min(innerWidth - 6, bounds.right + 5);
		const bottom = Math.min(innerHeight - 6, bounds.bottom + 5);
		rect =
			right > left && bottom > top
				? { left, top, width: right - left, height: bottom - top }
				: null;
		cardAtTop = bounds.top > innerHeight / 2;
	}
	function scheduleMeasure() {
		cancelAnimationFrame(frame);
		frame = requestAnimationFrame(measure);
	}
	async function move(next: number) {
		index = next;
		rect = null;
		cardAtTop = false;
		observer?.disconnect();
		await tick();
		if (stopped || !active) return;
		target = step.target ? document.querySelector<HTMLElement>(step.target) : null;
		if (target) {
			if (!target.closest('.user-navigation')) {
				target.scrollIntoView({ block: 'start', behavior: 'instant' });
				window.scrollBy({ top: -120, behavior: 'instant' });
			}
			observer?.observe(target);
		}
		measure();
		heading?.focus({ preventScroll: true });
	}
	async function savePreference() {
		if (saving) return;
		saving = true;
		warning = '';
		try {
			const response = await fetch(resolve('/api/account/tutorial'), {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: '{}',
				keepalive: true
			});
			if (!response.ok) throw new Error();
			if (!stopped && page.data.account?.id === accountId) await invalidateAll();
		} catch {
			if (!stopped)
				warning = 'Tutorial closed. Your preference could not be saved, so it may appear again.';
		} finally {
			if (!stopped) saving = false;
		}
	}
	function dismiss() {
		active = false;
		rect = null;
		observer?.disconnect();
		dialog.close();
		window.scrollTo({ top: 0, behavior: 'instant' });
		// Closing is immediate so a failed preference write cannot block emergency controls.
		void savePreference();
		if (replay) void goto(resolve('/user/dashboard'), { replace: true, reset: false });
		document.getElementById('user-content')?.focus({ preventScroll: true });
	}
	onMount(() => {
		observer = new ResizeObserver(scheduleMeasure);
		window.addEventListener('resize', scheduleMeasure);
		window.addEventListener('scroll', scheduleMeasure, true);
		if (shouldStart && accountId) {
			active = true;
			dialog.showModal();
			void move(0);
		}
		return () => {
			stopped = true;
			observer?.disconnect();
			cancelAnimationFrame(frame);
			window.removeEventListener('resize', scheduleMeasure);
			window.removeEventListener('scroll', scheduleMeasure, true);
		};
	});
</script>

{#if warning}
	<div class="user-error" role="status">
		<p>{warning}</p>
		<button class="btn mt-2 btn-outline" disabled={saving} onclick={savePreference}
			>Retry saving tutorial preference</button
		>
	</div>
{/if}

<dialog
	bind:this={dialog}
	class="user-tutorial"
	aria-labelledby="tutorial-title"
	aria-describedby="tutorial-copy"
	oncancel={(event) => {
		event.preventDefault();
		dismiss();
	}}
>
	{#if rect}
		<div
			class="tutorial-highlight"
			aria-hidden="true"
			style:left={`${rect.left}px`}
			style:top={`${rect.top}px`}
			style:width={`${rect.width}px`}
			style:height={`${rect.height}px`}
		></div>
	{/if}
	<section class="tutorial-card" class:at-top={cardAtTop}>
		<div class="tutorial-topline">
			<span
				><BookOpen size={17} aria-hidden="true" /> QUICK GUIDE · {index + 1} OF {steps.length}</span
			>
			<button class="tutorial-close" type="button" aria-label="Close tutorial" onclick={dismiss}
				><X size={21} /></button
			>
		</div>
		<h2 id="tutorial-title" tabindex="-1" bind:this={heading}>{step.title}</h2>
		<p id="tutorial-copy">{step.text}</p>
		<p class="tutorial-safety">Guide only. No SOS, calls or permission changes.</p>
		<div class="tutorial-actions">
			<button class="btn btn-ghost" onclick={dismiss}>Skip tutorial</button>
			{#if index > 0}<button
					class="btn btn-outline"
					aria-label="Previous tutorial step"
					onclick={() => move(index - 1)}><ArrowLeft size={17} /><span>Back</span></button
				>{/if}
			<button
				class="btn btn-primary"
				onclick={() => (index === steps.length - 1 ? dismiss() : move(index + 1))}
				>{index === steps.length - 1 ? 'Finish tutorial' : 'Next'}<ArrowRight size={17} /></button
			>
		</div>
	</section>
</dialog>

<style>
	.user-tutorial {
		position: fixed;
		inset: 0;
		width: 100vw;
		height: 100dvh;
		max-width: none;
		max-height: none;
		margin: 0;
		padding: 0;
		border: 0;
		background: transparent;
		color: var(--app-text);
	}
	.user-tutorial::backdrop {
		background: #0009;
	}
	.tutorial-highlight {
		position: fixed;
		border: 3px solid #f3cd65;
		border-radius: 14px;
		box-shadow: 0 0 0 2px #171717;
		pointer-events: none;
	}
	.tutorial-card {
		position: absolute;
		bottom: max(20px, env(safe-area-inset-bottom));
		left: 50%;
		transform: translateX(-50%);
		width: min(460px, calc(100% - 24px));
		max-height: calc(100dvh - 40px);
		overflow-y: auto;
		padding: 22px;
		border: 1px solid var(--app-border);
		border-radius: 18px;
		background: var(--app-surface);
		color: var(--app-text);
		box-shadow: 0 18px 70px #0006;
	}
	.tutorial-card.at-top {
		top: max(20px, env(safe-area-inset-top));
		bottom: auto;
	}
	.tutorial-topline {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
	}
	.tutorial-topline > span {
		display: flex;
		align-items: center;
		gap: 7px;
		font-size: 11px;
		letter-spacing: 0.08em;
		color: var(--app-muted);
	}
	.tutorial-close {
		display: grid;
		place-items: center;
		min-width: 44px;
		min-height: 44px;
		border-radius: 10px;
		color: var(--app-text);
	}
	h2 {
		margin: 8px 0 12px;
		font-size: 22px;
		font-weight: 600;
	}
	#tutorial-copy {
		font-size: 15px;
		line-height: 1.65;
	}
	.tutorial-safety {
		margin-top: 14px;
		font-size: 12px;
		color: var(--app-muted);
	}
	.tutorial-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: flex-end;
		gap: 8px;
		margin-top: 20px;
	}
	.tutorial-actions .btn {
		min-height: 44px;
	}
	.tutorial-actions > :first-child {
		margin-right: auto;
	}
</style>
