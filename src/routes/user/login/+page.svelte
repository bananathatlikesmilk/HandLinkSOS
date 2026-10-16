<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { ArrowLeft, Eye, EyeOff } from '@lucide/svelte';
	let email = $state('');
	let password = $state('');
	let repeatedPassword = $state('');
	let reveal = $state(false);
	let error = $state('');
	let busy = $state(false);
	let twoFactor = $state(false);
	let code = $state('');

	async function finishLogin() {
		const response = await fetch('/api/auth/get-session', { cache: 'no-store' });
		if (!response.ok) throw new Error('Unable to check your login. Please try again.');
		const session = await response.json();
		if (!session?.user) throw new Error('Unable to check your login. Please try again.');
		if ((session.user.role ?? 'user') !== 'user' || !session.user.emailVerified) {
			await fetch('/api/auth/sign-out', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: '{}'
			});
			throw new Error(
				session.user.emailVerified
					? 'This account cannot sign in here.'
					: 'Verify your email before logging in.'
			);
		}
		password = '';
		repeatedPassword = '';
		code = '';
		await invalidateAll();
		await goto(resolve('/user/dashboard'));
	}

	async function login(event: SubmitEvent) {
		event.preventDefault();
		if (busy) return;
		error = '';
		if (!twoFactor && password !== repeatedPassword) {
			error = 'Passwords do not match.';
			return;
		}
		busy = true;
		try {
			const response = await fetch(
				twoFactor ? '/api/auth/two-factor/verify-totp' : '/api/auth/sign-in/email',
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(
						twoFactor
							? { code, trustDevice: false }
							: { email: email.trim(), password, rememberMe: false }
					)
				}
			);
			const result = await response.json();
			if (!response.ok) {
				error =
					response.status === 429
						? 'Too many attempts. Please try again later.'
						: twoFactor
							? 'Unable to verify this code. Please try again.'
							: 'Unable to sign in. Check your email, password, and email verification.';
				return;
			}
			if (result.twoFactorRedirect) {
				twoFactor = true;
				password = '';
				repeatedPassword = '';
				return;
			}
			await finishLogin();
		} catch (cause) {
			error =
				cause instanceof Error && cause.message !== 'Failed to fetch'
					? cause.message
					: 'Unable to connect. Please try again.';
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head><title>Log In — HandLink</title></svelte:head>
<a class="btn btn-ghost btn-sm" href={resolve('/user')}><ArrowLeft size={18} />Back</a>
<section class="auth-panel user-panel">
	<h1 class="user-title">Log In</h1>
	<p class="user-copy">Welcome back. Your people are a tap away.</p>
	<form method="POST" onsubmit={login} class="auth-form">
		{#if !twoFactor}
			<label class="user-field" for="login-email"
				>Email<input
					id="login-email"
					class="input"
					type="email"
					bind:value={email}
					autocomplete="email"
					placeholder="Enter your email"
					required
					maxlength="254"
				/></label
			>
			<label class="user-field" for="login-password"
				>Password<input
					id="login-password"
					class="input"
					type={reveal ? 'text' : 'password'}
					bind:value={password}
					autocomplete="current-password"
					placeholder="Enter your password"
					minlength="12"
					maxlength="128"
					required
				/></label
			>
			<label class="user-field" for="login-repeat"
				>Re-password<input
					id="login-repeat"
					class="input"
					type={reveal ? 'text' : 'password'}
					bind:value={repeatedPassword}
					autocomplete="off"
					placeholder="Re-enter your password"
					minlength="12"
					maxlength="128"
					required
				/></label
			>
			<div class="login-tools">
				<button type="button" class="btn btn-ghost btn-sm" onclick={() => (reveal = !reveal)}
					>{#if reveal}<EyeOff size={17} />Hide passwords{:else}<Eye size={17} />Show passwords{/if}</button
				><a href={resolve('/user/forgot-password')}>Forgot password?</a>
			</div>
		{:else}
			<p class="user-copy">Enter the six-digit code from your authenticator app.</p>
			<label class="user-field" for="login-code"
				>Authenticator code<input
					id="login-code"
					class="input"
					inputmode="numeric"
					autocomplete="one-time-code"
					pattern={'[0-9]{6}'}
					maxlength="6"
					bind:value={code}
					required
				/></label
			>
		{/if}
		{#if error}<p class="user-error" role="alert">{error}</p>{/if}

		<button class="btn w-full btn-primary" type="submit" disabled={busy}
			>{busy ? 'Signing in?' : twoFactor ? 'Verify code' : 'Log In'}</button
		>
	</form>
	<p class="auth-footer">Don't have an account? <a href={resolve('/user/register')}>Sign up</a></p>
	<p class="auth-footer">
		Need email verification? <a
			href={resolve(`/user/verify?email=${encodeURIComponent(email.trim())}`)}>Verify email</a
		>
	</p>
</section>

<style>
	.auth-panel {
		margin-top: clamp(2rem, 9vh, 5rem);
	}
	.auth-form {
		display: grid;
		gap: 1rem;
		margin-top: 2rem;
	}
	.login-tools {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.75rem;
	}
	.auth-footer {
		text-align: center;
		font-size: 0.8rem;
		margin: 1.5rem 0;
		color: #b7b7ab;
	}
	a {
		text-underline-offset: 3px;
	}
</style>
