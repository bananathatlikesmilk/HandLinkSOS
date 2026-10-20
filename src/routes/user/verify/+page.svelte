<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { MailCheck, ArrowLeft } from '@lucide/svelte';
	import { page } from '$app/state';
	import { untrack } from 'svelte';
	import { accountRequest } from '#lib/user/account.ts';
	let email = $state(untrack(() => page.url.searchParams.get('email') ?? ''));
	const loginPath = '/login' as const;
	let busy = $state(false);
	let code = $state('');
	let error = $state('');
	let resent = $state(false);
	async function verify(event: SubmitEvent) {
		event.preventDefault();
		if (busy) return;
		error = '';
		busy = true;
		try {
			await accountRequest('/api/auth/email-otp/verify-email', { email: email.trim(), otp: code });
			code = '';
			await goto(resolve(loginPath));
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Verification failed.';
		} finally {
			busy = false;
		}
	}
	async function resend() {
		if (busy) return;
		error = '';
		busy = true;
		try {
			await accountRequest('/api/auth/email-otp/send-verification-otp', {
				email: email.trim(),
				type: 'email-verification'
			});
			resent = true;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Unable to resend.';
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head><title>Verify email — HandLink</title></svelte:head>
<a class="btn btn-ghost btn-sm" href={resolve(loginPath)}><ArrowLeft size={18} />Back to sign in</a>
<section class="verification user-panel">
	<MailCheck size={40} strokeWidth={1.3} />
	<h1 class="user-title">Verify your email</h1>
	<p class="user-copy">Confirm the email for your account.</p>

	<form method="POST" onsubmit={verify} class="verify-form">
		<label class="user-field"
			>Email<input
				class="input"
				type="email"
				bind:value={email}
				required
				maxlength="254"
				autocomplete="email"
			/></label
		>
		<label class="user-field" for="verify-code"
			>6-digit verification code<input
				id="verify-code"
				class="otp-input input"
				bind:value={code}
				inputmode="numeric"
				autocomplete="one-time-code"
				pattern={'[0-9]{6}'}
				minlength="6"
				maxlength="6"
				placeholder="000000"
				required
			/></label
		>
		{#if !page.data.emailConfigured}<p class="user-notice">
				Email delivery is not configured yet.
			</p>{/if}
		{#if error}<p class="user-error" role="alert">{error}</p>{/if}
		<button
			class="btn w-full btn-primary"
			type="submit"
			disabled={busy || !page.data.emailConfigured}>Verify email</button
		><button
			type="button"
			class="btn w-full btn-ghost"
			disabled={busy || !page.data.emailConfigured || !email}
			onclick={resend}>{resent ? 'Resend code' : 'Send verification code'}</button
		>
		{#if resent}<p class="user-copy" role="status">
				If the account needs verification, a new code has been requested.
			</p>{/if}
	</form>
</section>

<style>
	.verification {
		margin-top: 3rem;
		text-align: center;
	}
	.verification :global(svg) {
		margin: 0 auto 1.5rem;
	}
	.verify-form {
		display: grid;
		gap: 1rem;
		text-align: left;
	}
	.otp-input {
		text-align: center;
		letter-spacing: 0.65rem;
		font-size: 1.25rem;
	}
</style>
