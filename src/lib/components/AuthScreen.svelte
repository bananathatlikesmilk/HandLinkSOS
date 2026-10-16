<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { Eye, EyeOff, Pause, Play } from '@lucide/svelte';
	import StaffBrand from './StaffBrand.svelte';
	let {
		mode = 'login',
		role = 'dispatch'
	}: { mode?: 'login' | 'recovery'; role?: 'dispatch' | 'admin' } = $props();
	const loginPath = $derived(
		role === 'admin' ? ('/admin/login' as const) : ('/dispatch/login' as const)
	);
	const recoveryPath = $derived(
		role === 'admin' ? ('/admin/forgot-password' as const) : ('/dispatch/forgot-password' as const)
	);
	let email = $state('');
	let password = $state('');
	let showPassword = $state(false);
	let backgroundPaused = $state(false);
	let busy = $state(false);
	let error = $state('');
	let twoFactor = $state(false);
	let useBackupCode = $state(false);
	let code = $state('');
	const title = $derived(mode === 'recovery' ? 'Forgot password?' : 'Login');
	let recoveryStage = $state<'email' | 'code' | 'password' | 'success'>('email');
	let recoveryCode = $state('');
	let newPassword = $state('');
	let confirmPassword = $state('');
	let recoveryStatus = $state('');
	const emailConfigured = $derived(page.data.emailConfigured === true);

	function changeRecoveryEmail() {
		if (busy) return;
		recoveryStage = 'email';
		recoveryCode = '';
		newPassword = '';
		confirmPassword = '';
		recoveryStatus = '';
		error = '';
	}

	async function requestRecovery(resend = false) {
		if (busy || !emailConfigured) return;
		if (!resend && recoveryStage === 'password' && newPassword !== confirmPassword) {
			error = 'Passwords do not match.';
			return;
		}
		busy = true;
		error = '';
		recoveryStatus = '';
		const sending = resend || recoveryStage === 'email';
		try {
			const response = await fetch(
				sending
					? '/api/auth/email-otp/request-password-reset'
					: recoveryStage === 'code'
						? '/api/auth/email-otp/check-verification-otp'
						: '/api/auth/email-otp/reset-password',
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(
						sending
							? { email: email.trim() }
							: recoveryStage === 'code'
								? { email: email.trim(), otp: recoveryCode, type: 'forget-password' }
								: { email: email.trim(), otp: recoveryCode, password: newPassword }
					)
				}
			);
			if (!response.ok) {
				error =
					response.status === 429
						? 'Too many attempts. Please wait before trying again.'
						: sending
							? 'Unable to send a code. Please try again later.'
							: recoveryStage === 'code'
								? 'This code is invalid or expired. Check the code or request a new one.'
								: 'Unable to reset your password. Your code may have expired. Go back and request a new code.';
				return;
			}
			if (sending) {
				recoveryCode = '';
				newPassword = '';
				confirmPassword = '';
				recoveryStage = 'code';
				recoveryStatus =
					'If an account exists for this email, a reset code has been sent. Check your inbox and spam folder.';
			} else if (recoveryStage === 'code') {
				recoveryStage = 'password';
				recoveryStatus = 'Code checked. Choose a new password with 12 to 128 characters.';
			} else {
				recoveryStage = 'success';
				recoveryCode = '';
				newPassword = '';
				confirmPassword = '';
				recoveryStatus = 'Password updated. Sign in with your new password.';
			}
		} catch {
			error = 'Unable to connect. Please try again.';
		} finally {
			busy = false;
		}
	}

	function submitRecovery(event: SubmitEvent) {
		event.preventDefault();
		void requestRecovery();
	}

	function toggleBackupCode() {
		if (busy) return;
		useBackupCode = !useBackupCode;
		code = '';
		error = '';
	}

	async function finishLogin() {
		const response = await fetch('/api/auth/get-session', { cache: 'no-store' });
		if (!response.ok) throw new Error('Unable to check your login. Please try again.');
		const session = await response.json().catch(() => {
			throw new Error('Unable to connect. Please try again.');
		});
		if (!session?.user) throw new Error('Unable to check your login. Please try again.');
		if (
			session.user.role !== (role === 'admin' ? 'admin' : 'dispatcher') ||
			!session.user.emailVerified
		) {
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
		code = '';
		await invalidateAll();
		await goto(
			resolve(
				session.user.twoFactorEnabled
					? role === 'admin'
						? '/admin'
						: '/dispatch'
					: role === 'admin'
						? '/admin/security'
						: '/dispatch/security'
			)
		);
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (busy) return;
		busy = true;
		error = '';
		try {
			const response = await fetch(
				twoFactor
					? useBackupCode
						? '/api/auth/two-factor/verify-backup-code'
						: '/api/auth/two-factor/verify-totp'
					: '/api/auth/sign-in/email',
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(
						twoFactor
							? useBackupCode
								? { code: code.trim(), trustDevice: false, disableSession: false }
								: { code, trustDevice: false }
							: { email: email.trim(), password, rememberMe: false }
					)
				}
			);
			const result = await response.json().catch(() => {
				throw new Error('Unable to connect. Please try again.');
			});
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
				useBackupCode = false;
				code = '';
				password = '';
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

<svelte:head>
	<title>{mode === 'login' ? 'Sign in' : 'Reset password'} · HandLink</title>
	<meta name="description" content="Sign in to your HandLink staff account." />
</svelte:head>
<div
	class="auth-shell handlink-staff"
	class:background-paused={backgroundPaused}
	data-theme="handlink-staff"
>
	<header class="auth-brand"><StaffBrand href={loginPath} /></header>
	<main class="auth-main" id="main-content">
		<div class="auth-content">
			<h1 id="auth-title">{title}</h1>
			<p class="role-label">{role === 'admin' ? 'Administrator' : 'Dispatcher'}</p>
			{#if mode === 'recovery'}
				{#if !emailConfigured}
					<p class="auth-subtitle" role="status">
						Password recovery is unavailable because email delivery is not configured. Contact your
						administrator.
					</p>
				{/if}
				<p class="auth-subtitle" role="status" aria-live="polite">
					{recoveryStatus ||
						(recoveryStage === 'email' ? 'Enter your account email to reset your password.' : '')}
				</p>
				{#if recoveryStage !== 'success'}
					<form method="POST" onsubmit={submitRecovery} class="auth-form" aria-busy={busy}>
						<fieldset class="recovery-fields" disabled={busy}>
							{#if recoveryStage === 'email'}
								<div class="field">
									<label for="recovery-email">Email address</label>
									<input
										id="recovery-email"
										class="input w-full"
										type="email"
										autocomplete="email"
										maxlength="254"
										bind:value={email}
										required
									/>
								</div>
							{:else if recoveryStage === 'code'}
								<div class="field">
									<label for="recovery-code">Email verification code</label>
									<input
										id="recovery-code"
										class="input w-full"
										inputmode="numeric"
										autocomplete="one-time-code"
										pattern={'[0-9]{6}'}
										minlength="6"
										maxlength="6"
										bind:value={recoveryCode}
										required
									/>
								</div>
							{:else}
								<div class="field">
									<label for="new-password">New password</label>
									<input
										id="new-password"
										class="input w-full"
										type="password"
										autocomplete="new-password"
										minlength="12"
										maxlength="128"
										bind:value={newPassword}
										required
									/>
								</div>
								<div class="field">
									<label for="confirm-password">Confirm new password</label>
									<input
										id="confirm-password"
										class="input w-full"
										type="password"
										autocomplete="new-password"
										minlength="12"
										maxlength="128"
										bind:value={confirmPassword}
										required
									/>
								</div>
							{/if}
							{#if error}<p class="form-error" role="alert">{error}</p>{/if}
							<div class="form-actions">
								<button class="continue-button" type="submit" disabled={busy || !emailConfigured}
									>{busy
										? 'Please wait...'
										: recoveryStage === 'email'
											? 'Send verification code'
											: recoveryStage === 'code'
												? 'Verify code'
												: 'Reset password'}</button
								>
							</div>
							{#if recoveryStage !== 'email'}
								<button
									class="forgot-link"
									type="button"
									disabled={busy || !emailConfigured}
									onclick={() => requestRecovery(true)}>Resend code</button
								>
								<button
									class="forgot-link"
									type="button"
									disabled={busy}
									onclick={changeRecoveryEmail}>Change email</button
								>
							{/if}
						</fieldset>
					</form>
				{/if}
				<a href={resolve(loginPath)} class="continue-button recovery-link">Back to sign in</a>
			{:else}
				<form method="POST" onsubmit={submit} class="auth-form">
					{#if !twoFactor}
						<div class="field">
							<label for="email">Email address</label><input
								id="email"
								class="input w-full"
								type="email"
								autocomplete="username"
								placeholder="you@example.com"
								maxlength="254"
								bind:value={email}
								required
							/>
						</div>
						<div class="field">
							<label for="password">Password</label>
							<div class="password-field">
								<input
									id="password"
									class="input w-full"
									type={showPassword ? 'text' : 'password'}
									autocomplete="current-password"
									placeholder="Enter your password"
									minlength="12"
									maxlength="128"
									bind:value={password}
									required
								/><button
									type="button"
									class="password-toggle"
									aria-label={showPassword ? 'Hide password' : 'Show password'}
									aria-pressed={showPassword}
									onclick={() => (showPassword = !showPassword)}
									>{#if showPassword}<EyeOff size={19} />{:else}<Eye size={19} />{/if}</button
								>
							</div>
							<a class="forgot-link" href={resolve(recoveryPath)}>Forgot Password?</a>
						</div>
					{:else}
						<p class="auth-subtitle">
							{useBackupCode
								? 'Enter one of your saved backup codes. Each backup code can only be used once.'
								: 'Enter the six-digit code from your authenticator app.'}
						</p>
						<div class="field">
							<label for="verification-code"
								>{useBackupCode ? 'Backup code' : 'Authenticator code'}</label
							><input
								id="verification-code"
								class="input w-full"
								type="text"
								inputmode={useBackupCode ? 'text' : 'numeric'}
								autocomplete={useBackupCode ? 'off' : 'one-time-code'}
								pattern={useBackupCode ? '[A-Za-z0-9]{5}-[A-Za-z0-9]{5}' : '[0-9]{6}'}
								maxlength={useBackupCode ? 11 : 6}
								bind:value={code}
								required
							/>
						</div>
						<button type="button" class="forgot-link" disabled={busy} onclick={toggleBackupCode}>
							{useBackupCode ? 'Use authenticator code' : 'Use a backup code'}
						</button>
					{/if}
					{#if error}<p class="form-error" role="alert">{error}</p>{/if}
					<div class="form-actions">
						<button class="continue-button" type="submit" disabled={busy}
							>{busy ? 'Signing in...' : twoFactor ? 'Verify code' : 'Continue'}</button
						>
					</div>
				</form>
				{#if !twoFactor}
					<p class="verification-link">
						Need email verification? <a
							class="forgot-link"
							href={resolve(
								`/user/verify?email=${encodeURIComponent(email.trim())}&portal=${role}`
							)}>Verify email</a
						>
					</p>
				{/if}
			{/if}
		</div>
	</main>
	<button
		type="button"
		class="background-toggle"
		aria-label={backgroundPaused ? 'Play background animation' : 'Pause background animation'}
		aria-pressed={backgroundPaused}
		onclick={() => (backgroundPaused = !backgroundPaused)}
	>
		{#if backgroundPaused}<Play size={15} />{:else}<Pause size={15} />{/if}
		<span>{backgroundPaused ? 'Play background' : 'Pause background'}</span>
	</button>
</div>

<style>
	.auth-shell {
		position: relative;
		isolation: isolate;
		min-height: 100dvh;
		overflow: hidden;
		background: #000;
		color: #fff;
	}
	.auth-shell::before {
		content: '';
		position: absolute;
		z-index: -2;
		top: 50%;
		left: 50%;
		width: 590px;
		height: 590px;
		transform: translate(-50%, -43%);
		border-radius: 50%;
		background: conic-gradient(
			from 15deg,
			#e32e23 0deg,
			#b62b1d 95deg,
			#bd9724 185deg,
			#d8b341 255deg,
			#e32e23 360deg
		);
		filter: blur(45px);
		opacity: 0.8;
		pointer-events: none;
		animation: aurora-glow 14s ease-in-out infinite alternate;
	}
	.background-paused::before {
		animation-play-state: paused;
	}
	@keyframes aurora-glow {
		from {
			transform: translate(-52%, -43%) rotate(-3deg) skewX(-1.5deg) scale(1.015, 0.995);
		}
		50% {
			transform: translate(-50%, -44%) rotate(0deg) skewX(0deg) scale(1, 1.01);
		}
		to {
			transform: translate(-48%, -43%) rotate(3deg) skewX(1.5deg) scale(0.995, 1.015);
		}
	}
	.background-toggle {
		position: absolute;
		right: 20px;
		bottom: 16px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 7px;
		min-height: 44px;
		padding: 8px 12px;
		border: 1px solid #ffffff40;
		border-radius: 8px;
		background: #0008;
		color: #eee;
		font-size: 12px;
		cursor: pointer;
	}
	.background-toggle:hover {
		background: #ffffff1a;
	}
	.background-toggle:focus-visible {
		outline: 2px solid #fff;
		outline-offset: 4px;
	}
	@media (prefers-reduced-motion: reduce) {
		.auth-shell::before {
			animation: none;
		}
		.background-toggle {
			display: none;
		}
	}
	.auth-shell::after {
		content: '';
		position: absolute;
		z-index: -1;
		inset: 0;
		background: radial-gradient(ellipse 240px 240px at 50% 53%, #000b, transparent 100%);
		pointer-events: none;
	}
	.auth-brand {
		position: absolute;
		top: 32px;
		left: 0;
		right: 0;
		display: flex;
		justify-content: center;
	}
	.auth-main {
		display: grid;
		place-items: center;
		min-height: 100dvh;
		padding: 132px 24px 80px;
	}
	.auth-content {
		width: min(100%, 360px);
		text-shadow: 0 2px 14px #000;
	}
	h1 {
		margin: 0;
		text-align: center;
		font-size: 36px;
		font-weight: 400;
		line-height: 1.2;
	}
	.role-label {
		margin: 10px 0 36px;
		text-align: center;
		font-size: 15px;
		font-weight: 400;
	}
	.auth-subtitle {
		margin: 12px 0 24px;
		font-size: 14px;
		line-height: 1.7;
	}
	.auth-form {
		display: flex;
		flex-direction: column;
		gap: 24px;
	}
	.field {
		display: grid;
		gap: 8px;
		min-width: 0;
	}
	.field label {
		font-size: 15px;
	}
	.input {
		width: 100%;
		min-height: 48px;
		padding-inline: 14px;
		background: #0003;
		border: 1px solid #fff;
		border-radius: 9px;
		color: #fff;
		font-size: 16px;
		box-shadow: 0 0 14px #0002;
	}
	.input::placeholder {
		color: #e0d9d2;
	}
	.input:focus-visible,
	.continue-button:focus-visible,
	.password-toggle:focus-visible,
	.forgot-link:focus-visible {
		outline: 2px solid #fff;
		outline-offset: 4px;
	}
	.password-field {
		position: relative;
	}
	.password-field input {
		padding-right: 48px;
	}
	.password-toggle {
		position: absolute;
		right: 4px;
		top: 3px;
		display: grid;
		place-items: center;
		width: 42px;
		height: 42px;
		color: #fff;
		background: transparent;
		border: 0;
		border-radius: 5px;
		cursor: pointer;
	}
	.forgot-link {
		justify-self: end;
		display: inline-flex;
		align-items: center;
		min-height: 30px;
		font-size: 13px;
		color: #fff;
		text-underline-offset: 3px;
	}
	.forgot-link:hover {
		text-decoration: underline;
	}
	.form-actions {
		display: flex;
		justify-content: center;
		margin-top: 6px;
	}
	.continue-button {
		display: inline-flex;
		justify-content: center;
		align-items: center;
		min-width: 128px;
		min-height: 44px;
		padding: 10px 26px;
		border: 1px solid #fff;
		border-radius: 9px;
		background: #0003;
		color: #fff;
		font-size: 15px;
		text-shadow: 0 1px 8px #000;
		cursor: pointer;
	}
	.continue-button:hover:not(:disabled) {
		background: #ffffff1a;
	}
	.continue-button:disabled {
		opacity: 0.65;
		cursor: wait;
	}
	.recovery-link {
		display: flex;
		width: fit-content;
		margin: 24px auto 0;
	}
	.verification-link {
		margin: 24px 0 0;
		text-align: center;
		font-size: 13px;
	}
	.recovery-fields {
		display: flex;
		flex-direction: column;
		gap: 24px;
		min-width: 0;
		margin: 0;
		padding: 0;
		border: 0;
	}
	.form-error {
		margin: 0;
		color: #fff;
		background: #380b0be8;
		border: 1px solid #f2a699;
		border-radius: 8px;
		padding: 12px;
		font-size: 13px;
		line-height: 1.5;
	}
	@media (max-width: 520px) {
		.auth-brand {
			top: 28px;
		}
		.auth-main {
			padding: 120px 28px 60px;
		}
		.auth-shell::before {
			width: 470px;
			height: 550px;
			opacity: 0.65;
		}
		h1 {
			font-size: 32px;
		}
	}
</style>
