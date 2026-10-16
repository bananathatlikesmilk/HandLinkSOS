<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { ArrowLeft, ArrowRight } from '@lucide/svelte';
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
	let error = $state('');
	const sections = ['personal', 'medical', 'contacts'] as const;
	const titles = ['Personal information', 'Medical information', 'Emergency contacts'];
	async function next(event: SubmitEvent) {
		event.preventDefault();
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
<a class="btn btn-ghost btn-sm" href={resolve('/user')}><ArrowLeft size={18} />Back</a>
<section class="user-panel">
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
	<form onsubmit={next}>
		<UserProfileFields bind:profile section={sections[step]} />
		{#if step === 2}
			<div class="user-divider"></div>
			<h2 class="account-heading">Account details</h2>
			<div class="account-fields">
				<label class="user-field" for="register-email"
					>Your email<input
						id="register-email"
						class="input"
						type="email"
						bind:value={profile.email}
						autocomplete="email"
						required
						maxlength="254"
					/></label
				>
				<div class="user-field">
					<label for="register-password">Password</label><input
						id="register-password"
						class="input"
						type="password"
						bind:value={password}
						autocomplete="new-password"
						aria-describedby="register-password-help"
						minlength="12"
						maxlength="128"
						required
					/>
					<p id="register-password-help" class="user-copy">Use at least 12 characters.</p>
				</div>
				<label class="user-field" for="register-repeat"
					>Re-password<input
						id="register-repeat"
						class="input"
						type="password"
						bind:value={repeatedPassword}
						autocomplete="new-password"
						minlength="12"
						maxlength="128"
						required
					/></label
				>
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

<style>
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
