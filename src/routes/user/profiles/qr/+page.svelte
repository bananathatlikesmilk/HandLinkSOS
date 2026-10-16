<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { Mail, QrCode, ShieldCheck } from '@lucide/svelte';
	import { BrowserQRCodeSvgWriter } from '@zxing/browser';
	import { apiRequest } from '#lib/client/request.ts';
	let code = $state('');
	let error = $state('');
	let notice = $state('');
	let busy = $state(false);
	let requestId = $state('');
	let challengeExpiresAt = $state(0);
	let resendAt = $state(0);
	let invitationId = $state('');
	let token = $state('');
	let expiresAt = $state(0);
	let clock = $state(0);
	const remaining = $derived(Math.max(0, Math.ceil((expiresAt - clock) / 1000)));
	const cooldown = $derived(Math.max(0, Math.ceil((resendAt - clock) / 1000)));
	const hasProfile = $derived(Boolean(page.data.accountProfile?.id));
	onMount(() => {
		clock = Date.now();
		const timer = setInterval(() => {
			clock = Date.now();
			if (token && clock >= expiresAt) {
				token = '';
				invitationId = '';
				notice = 'Your QR code expired. Request a new email code to show another.';
			}
		}, 1000);
		return () => clearInterval(timer);
	});
	async function sendCode() {
		if (busy || cooldown || !hasProfile) return;
		busy = true;
		error = '';
		notice = '';
		code = '';
		try {
			const result = await apiRequest<{ requestId: string; expiresAt: string }>(
				'/api/trusted/qr/challenge',
				{ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }
			);
			requestId = result.requestId;
			challengeExpiresAt = Date.parse(result.expiresAt);
			clock = Date.now();
			resendAt = clock + 60_000;
			notice =
				'Verification code sent. Check your email and spam folder. It expires in five minutes.';
		} catch (reason) {
			error = reason instanceof Error ? reason.message : 'Unable to send your verification code.';
		} finally {
			busy = false;
		}
	}
	async function verify(event: SubmitEvent) {
		event.preventDefault();
		if (busy || !requestId) return;
		if (Date.now() >= challengeExpiresAt) {
			error = 'Your email code expired. Request a new code.';
			code = '';
			return;
		}
		busy = true;
		error = '';
		notice = '';
		const submittedCode = code;
		code = '';
		try {
			const result = await apiRequest<{
				invitationId: string;
				token: string;
				expiresAt: string;
			}>('/api/trusted/qr', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ requestId, code: submittedCode })
			});
			invitationId = result.invitationId;
			token = result.token;
			expiresAt = Date.parse(result.expiresAt);
			clock = Date.now();
			requestId = '';
		} catch (reason) {
			error = reason instanceof Error ? reason.message : 'Unable to verify your email code.';
		} finally {
			busy = false;
		}
	}
	async function lockQr() {
		if (busy || !invitationId) return;
		busy = true;
		error = '';
		try {
			await apiRequest(`/api/trusted/qr/${invitationId}`, {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: '{}'
			});
			token = '';
			invitationId = '';
			notice = 'QR code locked. Any unused code is invalid. Review existing requests in Profiles.';
		} catch (reason) {
			error = reason instanceof Error ? reason.message : 'Unable to lock your QR code. Try again.';
		} finally {
			busy = false;
		}
	}
	function renderQr(contents: string) {
		return (element: HTMLElement) => {
			const svg = new BrowserQRCodeSvgWriter().write(contents, 280, 280);
			svg.setAttribute('role', 'img');
			svg.setAttribute('aria-label', 'Your single-use HandLink trusted profile invitation');
			element.appendChild(svg);
			return () => element.replaceChildren();
		};
	}
</script>

<svelte:head><title>My QR code · HandLink</title></svelte:head>
<div class="space-y-6">
	<header>
		<p class="user-kicker">Add profiles</p>
		<h1 class="user-title">My QR code</h1>
		<p class="user-copy mt-2">Invite someone you trust to request access to your profile.</p>
	</header>
	{#if !hasProfile}
		<section class="user-panel space-y-4">
			<Mail size={30} />
			<h2 class="text-lg font-semibold">Save your profile first</h2>
			<p class="user-copy">Complete your personal information before creating an invitation.</p>
			<a class="btn w-full btn-primary" href={resolve('/user/profiles/edit')}>Edit my profile</a>
		</section>
	{:else if token && remaining > 0}
		<section class="user-panel space-y-5 text-center" aria-labelledby="qr-heading">
			<h2 id="qr-heading" class="text-xl font-semibold">Your trusted profile invitation</h2>
			<div class="qr-image" {@attach renderQr('handlink:qr:v1:' + token)}></div>
			<p class="user-copy">
				Expires in <strong class="text-base-content"
					>{Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}</strong
				>
			</p>
			<p class="user-copy text-sm">
				This code works once and contains no personal information. Scanning creates a request. You
				must approve it in Profiles before anyone can send SOS for you.
			</p>
			<button class="btn w-full btn-outline" disabled={busy} onclick={lockQr}
				>Hide and lock QR code</button
			>
		</section>
	{:else}
		<section class="user-panel space-y-5">
			<div class="flex items-center gap-3">
				<ShieldCheck size={28} />
				<h2 class="text-lg font-semibold">Confirm with your email</h2>
			</div>
			<p class="user-copy">
				Request an email code to unlock a single-use QR invitation for ten minutes.
			</p>
			<p class="user-copy break-words">Account email: {page.data.account?.email}</p>
			<button class="btn w-full btn-outline" disabled={busy || cooldown > 0} onclick={sendCode}
				><Mail size={18} />{cooldown > 0
					? `Send again in ${cooldown}s`
					: requestId
						? 'Resend verification code'
						: 'Send verification code'}</button
			>
			{#if requestId}
				<form class="space-y-4" onsubmit={verify}>
					<label class="user-field"
						>Email verification code<input
							class="input w-full tracking-[0.3em]"
							bind:value={code}
							inputmode="numeric"
							autocomplete="one-time-code"
							pattern={'[0-9]{6}'}
							minlength="6"
							maxlength="6"
							required
							disabled={busy}
						/></label
					>
					<button class="btn w-full btn-primary" type="submit" disabled={busy}
						><QrCode size={18} />{busy ? 'Please wait…' : 'Verify and show QR code'}</button
					>
				</form>
			{/if}
		</section>
	{/if}
	{#if error}<p class="user-error" role="alert">{error}</p>{/if}
	{#if notice}<p class="user-notice" role="status">{notice}</p>{/if}
	<a class="btn w-full btn-outline" href={resolve('/user/profiles')}>Back to profiles</a>
</div>

<style>
	.qr-image {
		display: grid;
		place-items: center;
		background: #fff;
		border-radius: 14px;
		padding: 16px;
		width: fit-content;
		max-width: 100%;
		margin-inline: auto;
	}
	.qr-image :global(svg) {
		width: 100%;
		max-width: 280px;
		height: auto;
	}
</style>
