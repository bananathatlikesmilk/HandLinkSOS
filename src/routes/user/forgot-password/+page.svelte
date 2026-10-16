<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { ArrowLeft, Mail } from '@lucide/svelte';
	import { getUserPreview } from '#lib/user/preview.svelte.ts';
	import { page } from '$app/state';
	import { accountRequest } from '#lib/user/account.ts';
	let busy = $state(false);
	const preview = getUserPreview();
	let email = $state('');
	let code = $state('');
	let sent = $state(false);
	let error = $state('');
	let resent = $state(false);
	async function submit(event: SubmitEvent) {
		event.preventDefault();
		error = '';
		busy = true;
		try {
			if (!sent) {
				await accountRequest('/api/auth/email-otp/request-password-reset', { email: email.trim() });
				preview.recoveryEmail = email.trim();
				preview.recoveryVerified = false;
				sent = true;
			} else {
				await accountRequest('/api/auth/email-otp/check-verification-otp', {
					email: email.trim(),
					otp: code,
					type: 'forget-password'
				});
				preview.recoveryCode = code;
				preview.recoveryVerified = true;
				code = '';
				await goto(resolve('/user/reset-password'));
			}
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Recovery failed.';
		} finally {
			busy = false;
		}
	}
	async function resend() {
		error = '';
		busy = true;
		try {
			await accountRequest('/api/auth/email-otp/request-password-reset', { email: email.trim() });
			resent = true;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Request failed.';
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head><title>Forgot password — HandLink</title></svelte:head>
<a class="btn btn-ghost btn-sm" href={resolve('/user/login')}
	><ArrowLeft size={18} />Back to Log In</a
>
<section class="recovery user-panel">
	<Mail size={36} strokeWidth={1.4} />
	<h1 class="user-title">Forgot Password</h1>
	<p class="user-copy">
		{sent
			? 'Enter the email verification code to continue.'
			: 'Enter your account email to reset your password.'}
	</p>
	<form method="POST" onsubmit={submit} class="recovery-form">
		<label class="user-field" for="recovery-email"
			>Email<input
				id="recovery-email"
				class="input"
				type="email"
				bind:value={email}
				autocomplete="email"
				readonly={sent}
				required
				maxlength="254"
				placeholder="Enter your email"
			/></label
		>
		{#if sent}<label class="user-field" for="recovery-code"
				>6-digit verification code<input
					id="recovery-code"
					class="input"
					bind:value={code}
					inputmode="numeric"
					autocomplete="one-time-code"
					pattern={'[0-9]{6}'}
					minlength="6"
					maxlength="6"
					required
					placeholder="000000"
				/></label
			>{/if}
		{#if !page.data.emailConfigured}<p class="user-notice">
				Password recovery is unavailable until email delivery is configured.
			</p>{/if}
		{#if error}<p class="user-error" role="alert">{error}</p>{/if}
		<button
			type="submit"
			class="btn w-full btn-primary"
			disabled={busy || !page.data.emailConfigured}
			>{sent ? 'Verify code' : 'Send verification code'}</button
		>
		{#if sent}<button
				type="button"
				class="btn w-full btn-outline"
				onclick={() => {
					sent = false;
					code = '';
					error = '';
					resent = false;
					preview.recoveryVerified = false;
				}}>Change email</button
			><button
				type="button"
				class="btn btn-ghost"
				disabled={busy || !page.data.emailConfigured}
				onclick={resend}>Resend code</button
			>{/if}
		{#if resent}<p class="user-copy" role="status">
				If the account exists, a recovery code has been requested.
			</p>{/if}
	</form>
</section>

<style>
	.recovery {
		margin-top: 3rem;
	}
	.recovery :global(svg) {
		margin-bottom: 1.5rem;
	}
	.recovery-form {
		display: grid;
		gap: 1rem;
		margin-top: 2rem;
	}
</style>
