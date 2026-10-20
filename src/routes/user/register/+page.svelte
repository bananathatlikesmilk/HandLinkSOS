<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { ArrowLeft, ArrowRight, Eye, EyeOff } from '@lucide/svelte';
	import AuthFrame from '#lib/components/AuthFrame.svelte';
	import UserProfileFields from '#lib/user/UserProfileFields.svelte';
	import { emptyProfile } from '#lib/user/preview.svelte.ts';
	import { page } from '$app/state';
	import { profilePayload, accountRequest } from '#lib/user/account.ts';
	let busy = $state(false);
	let profile = $state({
		...emptyProfile(),
		contacts: [
			{
				id: 'registration-contact',
				firstName: '',
				lastName: '',
				phone: '',
				email: '',
				relationship: ''
			}
		]
	});
	let step = $state(0);
	let password = $state('');
	let repeatedPassword = $state('');
	let showPassword = $state(false);
	let showConfirmation = $state(false);
	let error = $state('');
	const sections = ['personal', 'medical', 'contacts'] as const;
	const titles = ['Personal information', 'Medical information', 'Emergency contacts'];
	function clearValidation(event: Event) {
		const field = event.target;
		if (field instanceof HTMLInputElement || field instanceof HTMLSelectElement)
			field.setCustomValidity('');
	}
	function validStep(form: HTMLFormElement) {
		for (const field of form.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
			'input[required], select[required]'
		)) {
			field.setCustomValidity('');
			if (!field.value.trim()) field.setCustomValidity('Complete this required field.');
			if (field instanceof HTMLInputElement && field.type === 'tel') {
				const number = field.value.trim().replace(/[\s()-]/g, '');
				if (
					!/^\+[1-9]\d{7,14}$/.test(number) ||
					(number.startsWith('+639') && !/^\+639\d{9}$/.test(number))
				)
					field.setCustomValidity('Enter a complete phone number, such as +639171234567.');
			}
		}
		if (form.checkValidity()) return true;
		form.reportValidity();
		return false;
	}
	async function next(event: SubmitEvent) {
		event.preventDefault();
		if (busy || !validStep(event.currentTarget as HTMLFormElement)) return;
		error = '';
		if (step < 2) {
			step += 1;
			return;
		}
		if (!profile.contacts.length) {
			error = 'Add at least one emergency contact.';
			return;
		}
		if (password !== repeatedPassword) {
			error = 'Passwords do not match.';
			return;
		}
		if (!page.data.emailConfigured) {
			error = 'Email delivery must be configured before account creation.';
			return;
		}
		busy = true;
		try {
			await accountRequest('/api/register', {
				email: profile.email.trim(),
				password,
				profile: profilePayload(profile)
			});
			password = '';
			repeatedPassword = '';
			await goto(resolve(`/user/verify?email=${encodeURIComponent(profile.email.trim())}`));
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Account creation failed.';
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head><title>Create Account — HandLink</title></svelte:head>
<AuthFrame>
	<main id="user-content" class="registration-main">
		<div class="registration-content">
			<a class="btn btn-ghost btn-sm" href={resolve('/user')}><ArrowLeft size={18} />Back</a>
			<section class="user-panel registration-panel">
				<p class="user-kicker">Account</p>
				<h1 class="user-title">Create Account</h1>
				<ol class="registration-progress" aria-label="Registration progress">
					{#each titles as title, index (title)}<li
							class:current={step === index}
							class:complete={step > index}
							aria-current={step === index ? 'step' : undefined}
						>
							<span>{index + 1}</span>{title}
						</li>{/each}
				</ol>
				<p class="user-copy">Fields marked <span aria-hidden="true">*</span> are required.</p>
				<form onsubmit={next} oninput={clearValidation}>
					<UserProfileFields bind:profile section={sections[step]} />
					{#if step === 2}
						<div class="user-divider"></div>
						<h2 class="account-heading">Account details</h2>
						<div class="account-fields">
							<label class="user-field" for="register-email"
								><span>Your email<span aria-hidden="true"> *</span></span><input
									id="register-email"
									aria-label="Your email"
									class="input"
									type="email"
									bind:value={profile.email}
									autocomplete="email"
									required
									maxlength="254"
								/></label
							>
							<div class="user-field">
								<label for="register-password">Password<span aria-hidden="true"> *</span></label>
								<div class="password-control">
									<input
										id="register-password"
										aria-label="Password"
										class="input"
										type={showPassword ? 'text' : 'password'}
										bind:value={password}
										autocomplete="new-password"
										aria-describedby="register-password-help"
										minlength="12"
										maxlength="128"
										required
									/><button
										type="button"
										class="btn btn-ghost"
										aria-label={showPassword ? 'Hide password' : 'Show password'}
										aria-pressed={showPassword}
										onclick={() => (showPassword = !showPassword)}
										>{#if showPassword}<EyeOff size={20} />{:else}<Eye size={20} />{/if}</button
									>
								</div>
								<p id="register-password-help" class="user-copy">Use at least 12 characters.</p>
							</div>
							<div class="user-field">
								<label for="register-repeat"
									>Confirm password<span aria-hidden="true"> *</span></label
								>
								<div class="password-control">
									<input
										id="register-repeat"
										aria-label="Confirm password"
										class="input"
										type={showConfirmation ? 'text' : 'password'}
										bind:value={repeatedPassword}
										autocomplete="new-password"
										minlength="12"
										maxlength="128"
										required
									/><button
										type="button"
										class="btn btn-ghost"
										aria-label={showConfirmation
											? 'Hide confirm password'
											: 'Show confirm password'}
										aria-pressed={showConfirmation}
										onclick={() => (showConfirmation = !showConfirmation)}
										>{#if showConfirmation}<EyeOff size={20} />{:else}<Eye size={20} />{/if}</button
									>
								</div>
							</div>
						</div>
					{/if}
					{#if error}<p class="user-error" role="alert">{error}</p>{/if}
					{#if !page.data.emailConfigured}<p class="user-notice">
							Account creation is unavailable until email delivery is configured.
						</p>{/if}
					<div class="user-actions registration-actions">
						{#if step > 0}<button
								class="btn btn-outline"
								type="button"
								onclick={() => {
									step -= 1;
									error = '';
								}}><ArrowLeft size={18} />Previous</button
							>{/if}<button
							class="btn btn-primary"
							type="submit"
							disabled={busy || (step === 2 && !page.data.emailConfigured)}
							>{step === 2 ? 'Create Account' : 'Continue'}<ArrowRight size={18} /></button
						>
					</div>
				</form>
				<p class="registration-footer">
					Already have an account? <a href={resolve('/user/login')}>Log In</a>
				</p>
			</section>
		</div>
	</main>
</AuthFrame>

<style>
	.registration-main {
		min-height: 100dvh;
		padding: 116px 24px 96px;
	}
	.registration-content {
		max-width: 640px;
		margin-inline: auto;
	}
	.registration-panel {
		margin-top: 16px;
		border: 1px solid var(--app-border);
		border-radius: 20px;
		background: color-mix(in srgb, var(--app-surface) 94%, transparent);
		padding: clamp(20px, 4vw, 32px);
	}
	.registration-panel h1 {
		font-size: 32px;
		font-weight: 400;
		text-align: center;
	}
	.password-control {
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}
	.password-control input {
		flex: 1;
		min-width: 0;
	}
	.registration-progress {
		list-style: none;
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 0.75rem;
		padding: 0;
		margin: 1.5rem 0 2rem;
	}
	.registration-progress li {
		display: grid;
		gap: 0.5rem;
		color: #a3a396;
		font-size: 0.65rem;
	}
	.registration-progress span {
		border: 1px solid #5b5c50;
		border-radius: 50%;
		width: 1.75rem;
		height: 1.75rem;
		display: grid;
		place-items: center;
	}
	.registration-progress .current {
		color: #eeeedb;
	}
	.current span,
	.complete span {
		background: #d9d9c8;
		color: #17180f;
		border-color: #d9d9c8;
	}
	.account-heading {
		font-size: 1rem;
		margin: 1.5rem 0 1rem;
		font-weight: 650;
	}
	.account-fields {
		display: grid;
		gap: 1rem;
		margin-bottom: 1.5rem;
	}
	.registration-actions {
		display: flex;
		gap: 0.75rem;
		margin-top: 1rem;
	}
	.registration-actions .btn {
		flex: 1;
	}
	.registration-footer {
		text-align: center;
		font-size: 0.8rem;
		margin-top: 1.5rem;
		color: #b7b7ab;
	}
</style>
