<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { Check } from '@lucide/svelte';
	import UserProfileFields from '#lib/user/UserProfileFields.svelte';
	import { getUserPreview, type UserProfile } from '#lib/user/preview.svelte.ts';
	import { accountRequest, loadAccountProfile, profilePayload } from '#lib/user/account.ts';
	import { clearFieldValidation, validateForm } from '#lib/client/form-validation.ts';
	const preview = getUserPreview();
	let draft = $state<UserProfile>(structuredClone($state.snapshot(preview.profile)));
	let busy = $state(false);
	let errorMessage = $state('');
	async function save(event: SubmitEvent) {
		event.preventDefault();
		if (busy) return;
		errorMessage = validateForm(event.currentTarget as HTMLFormElement);
		if (errorMessage) return;
		busy = true;
		errorMessage = '';
		try {
			await accountRequest('/api/profile', profilePayload($state.snapshot(draft)), 'PUT');
			preview.profile = await loadAccountProfile(preview.profile.email);
			preview.qrApprovedUntil = 0;
			await goto(resolve('/user/profiles/details'), { invalidateAll: true });
		} catch (error) {
			errorMessage =
				error instanceof Error ? error.message : 'Unable to save your profile. Please try again.';
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head><title>Edit profile · HandLink</title></svelte:head>
<div class="space-y-6">
	<header>
		<p class="user-kicker">My profile</p>
		<h1 class="user-title">Edit information</h1>
		<p class="user-copy mt-2">Keep the details you registered up to date.</p>
	</header>
	<p class="user-copy">Changes are saved to your account.</p>
	{#if errorMessage}<p class="user-notice" role="alert">{errorMessage}</p>{/if}
	<form
		class="space-y-6"
		novalidate
		onsubmit={save}
		oninput={(event) => {
			clearFieldValidation(event);
			errorMessage = '';
		}}
		aria-busy={busy}
	>
		<fieldset disabled={busy} class="min-w-0 space-y-6">
			<UserProfileFields bind:profile={draft} />
			<div class="user-panel">
				<p class="user-kicker">Account email</p>
				<p class="mt-2 break-words">{preview.profile.email}</p>
				<p class="user-copy mt-2 text-sm">Your account email stays the same.</p>
			</div>
			<div class="user-actions">
				<a class="btn btn-outline" href={resolve('/user/profiles')}>Cancel</a><button
					class="btn btn-primary"
					type="submit"><Check size={18} />{busy ? 'Saving…' : 'Save changes'}</button
				>
			</div>
		</fieldset>
	</form>
</div>
