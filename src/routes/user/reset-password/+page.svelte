<script lang="ts">
	import { resolve } from '$app/paths';
	import { KeyRound, CheckCircle2 } from '@lucide/svelte';
	import { getUserPreview } from '#lib/user/preview.svelte.ts';
	import { accountRequest } from '#lib/user/account.ts';
	let busy = $state(false);
	const preview = getUserPreview();
	let password = $state('');
	let repeatedPassword = $state('');
	let error = $state('');
	let complete = $state(false);
	async function reset(event: SubmitEvent) {
		event.preventDefault();
		error = '';
		if (!preview.recoveryVerified) {
			error = 'Verify your email code first.';
			return;
		}
		if (password !== repeatedPassword) {
			error = 'Passwords do not match.';
			return;
		}
		busy = true;
		try {
			await accountRequest('/api/auth/email-otp/reset-password', {
				email: preview.recoveryEmail,
				otp: preview.recoveryCode,
				password
			});
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Reset failed.';
			busy = false;
			return;
		}
		busy = false;
		preview.recoveryCode = '';
		password = '';
		repeatedPassword = '';
		preview.recoveryVerified = false;
		preview.recoveryEmail = '';
		complete = true;
	}
</script>

<svelte:head><title>Reset password — HandLink</title></svelte:head>
<section class="reset user-panel">
	{#if complete}
		<CheckCircle2 size={40} strokeWidth={1.4} />
		<h1 class="user-title">You're ready to log in</h1>
		<p class="user-copy">Your password was reset successfully.</p>
		<a class="btn w-full btn-primary" href={resolve('/user/login')}>Back to Log In</a>
	{:else if !preview.recoveryVerified}
		<KeyRound size={40} strokeWidth={1.4} />
		<h1 class="user-title">Verify your email first</h1>
		<p class="user-copy">Use the recovery code before choosing a new password.</p>
		<a class="btn w-full btn-primary" href={resolve('/user/forgot-password')}
			>Go to password recovery</a
		>
	{:else}
		<KeyRound size={40} strokeWidth={1.4} />
		<h1 class="user-title">New Password</h1>
		<p class="user-copy">Choose a new password for {preview.recoveryEmail}.</p>
		<form method="POST" onsubmit={reset} class="reset-form">
			<div class="user-field">
				<label for="reset-password">New password</label><input
					id="reset-password"
					class="input"
					type="password"
					bind:value={password}
					autocomplete="new-password"
					aria-describedby="reset-password-help"
					minlength="12"
					maxlength="128"
					required
				/>
				<p id="reset-password-help" class="user-copy">Use at least 12 characters.</p>
			</div>
			<label class="user-field" for="reset-repeat"
				>Re-password<input
					id="reset-repeat"
					class="input"
					type="password"
					bind:value={repeatedPassword}
					autocomplete="new-password"
					minlength="12"
					maxlength="128"
					required
				/></label
			>
			{#if error}<p class="user-error" role="alert">{error}</p>{/if}

			<button type="submit" class="btn w-full btn-primary" disabled={busy}>Reset password</button>
		</form>
	{/if}
</section>

<style>
	.reset {
		margin-top: 4rem;
	}
	.reset :global(svg) {
		margin-bottom: 1.5rem;
	}
	.reset > .btn {
		margin-top: 2rem;
	}
	.reset-form {
		display: grid;
		gap: 1rem;
		margin-top: 2rem;
	}
</style>
