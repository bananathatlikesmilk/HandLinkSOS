<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { ChevronDown, LogOut, ShieldCheck, UserRound, X } from '@lucide/svelte';
	import { emptyProfile, getUserPreview } from '#lib/user/preview.svelte.ts';
	import { accountRequest } from '#lib/user/account.ts';
	import { getDeviceLocation, disableNativeSharing } from '#lib/native/location.ts';
	const preview = getUserPreview();
	let privacyOpen = $state(false);
	let deactivateConfirm = $state(false);
	let busy = $state(false);
	let errorMessage = $state('');
	let checkingLocation = $state(false);
	let locationMessage = $state('');
	let locationError = $state('');
	let mounted = false;
	onMount(() => {
		mounted = true;
		return () => {
			mounted = false;
		};
	});
	async function checkLocation() {
		if (checkingLocation || busy) return;
		checkingLocation = true;
		locationMessage = '';
		locationError = '';
		const account = page.data.account?.id;
		try {
			await getDeviceLocation();
			if (mounted && account === page.data.account?.id)
				locationMessage =
					'Location access works. This check did not save or send your coordinates.';
		} catch (cause) {
			if (mounted && account === page.data.account?.id)
				locationError =
					cause instanceof Error
						? cause.message
						: 'Could not access location. Check device permissions.';
		} finally {
			if (mounted) checkingLocation = false;
		}
	}
	async function stopNativeBeforeAccountAction() {
		let warning = '';
		await disableNativeSharing().catch(() => {
			warning =
				' Android screen-off updates could not be confirmed stopped. Retry or stop sharing from the sharing page.';
		});
		return warning;
	}
	function clearAccount() {
		preview.logout();
		preview.profile = emptyProfile();
		preview.trusted = [];
		preview.notifications = [];
		preview.incoming = [];
		preview.emailVerified = false;
	}
	async function logout() {
		if (busy) return;
		busy = true;
		errorMessage = '';
		const nativeWarning = await stopNativeBeforeAccountAction();
		try {
			await accountRequest('/api/auth/sign-out');
			clearAccount();
			await goto(resolve('/user/login'), { invalidateAll: true });
		} catch (error) {
			errorMessage =
				(error instanceof Error ? error.message : 'Unable to log out. Please try again.') +
				nativeWarning;
		} finally {
			busy = false;
		}
	}
	async function deactivate() {
		if (busy) return;
		busy = true;
		errorMessage = '';
		const nativeWarning = await stopNativeBeforeAccountAction();
		try {
			await accountRequest('/api/account/deactivate');
			clearAccount();
			deactivateConfirm = false;
			await goto(resolve('/user'), { invalidateAll: true });
		} catch (error) {
			errorMessage =
				(error instanceof Error
					? error.message
					: 'Unable to deactivate your account. Please try again.') + nativeWarning;
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head><title>Settings · HandLink</title></svelte:head>
<div class="settings-screen">
	<h1 class="user-title text-center">Settings</h1>
	<div class="settings-list">
		<div class="setting-row">
			<div>
				<strong>Location access</strong>
				<p>Permissions are controlled in Android or browser settings.</p>
			</div>
			<button
				class="btn btn-outline btn-sm"
				disabled={checkingLocation || busy}
				onclick={checkLocation}
			>
				{checkingLocation ? 'Checking location…' : 'Check location access'}
			</button>
		</div>
		<div class="setting-row">
			<label for="user-overlay-toggle"
				><strong>Display over other apps</strong><span
					>Not implemented yet. Installing the Android app does not enable this permission.</span
				></label
			><input id="user-overlay-toggle" class="toggle" type="checkbox" disabled checked={false} />
		</div>
		<div class="setting-row">
			<div>
				<strong>Privacy and security notes</strong>
				<p>How your safety information is handled.</p>
			</div>
			<button
				class="view-button btn btn-primary"
				aria-expanded={privacyOpen}
				aria-controls="user-privacy-notice"
				onclick={() => {
					privacyOpen = !privacyOpen;
				}}>{privacyOpen ? 'Close' : 'View'}<ChevronDown size={16} /></button
			>
		</div>
	</div>
	{#if locationMessage}<p class="user-notice mt-4" role="status">{locationMessage}</p>{/if}
	{#if locationError}<p class="user-error mt-4" role="alert">{locationError}</p>{/if}
	{#if privacyOpen}<section
			id="user-privacy-notice"
			class="user-panel space-y-4"
			aria-labelledby="privacy-notice-title"
		>
			<div class="flex items-center gap-3">
				<ShieldCheck size={23} strokeWidth={1.3} />
				<h2 id="privacy-notice-title">Privacy and security</h2>
			</div>
			<p class="user-copy">
				SOS alerts save your device location and the selected person's profile for authorized
				dispatchers. Location sharing lets you choose approved recipients and a timer. You can stop
				sharing at any time.
			</p>
			<p class="user-copy">
				Share only information you are comfortable providing. A trusted profile can use SOS on your
				behalf only after you approve their QR request. Reciprocal SOS access needs separate
				approval.
			</p>
			<p class="user-copy">
				Your profile changes are saved to your account. SOS and sharing updates create in-app
				notifications. Incoming background push is not connected. Calls use the dispatcher's
				separate phone system; this app does not place calls.
			</p>
			<p class="user-copy">
				Deactivation blocks account access and keeps existing records. It does not delete your
				profile.
			</p>
		</section>{/if}
	<div class="user-notice mt-6">
		Browser location updates require this app to stay visible. In the Android app, enable screen-off
		updates from Share location for an ongoing location notification. Display over other apps
		remains unavailable.
	</div>
	<section class="account-status user-panel">
		<UserRound size={23} strokeWidth={1.3} />
		<div>
			<h2>{preview.fullName}</h2>
			<p class="user-copy text-xs">
				{preview.accountActive ? 'Account · Active' : 'Account · Deactivated'}
			</p>
		</div>
	</section>
	{#if errorMessage}<p class="user-notice mt-5" role="alert">{errorMessage}</p>{/if}
	<div class="user-actions">
		<button class="btn btn-primary" disabled={busy} onclick={logout}
			><LogOut size={17} /> Log out</button
		>{#if preview.accountActive}<button
				class="btn btn-outline"
				disabled={busy}
				aria-expanded={deactivateConfirm}
				aria-controls="user-deactivate-confirm"
				onclick={() => {
					deactivateConfirm = true;
				}}>Deactivate account</button
			>{:else}<a class="btn btn-outline" href={resolve('/user')}>Back to welcome</a>{/if}
	</div>
	{#if deactivateConfirm}<section
			id="user-deactivate-confirm"
			class="deactivate-confirm"
			aria-labelledby="deactivate-title"
		>
			<div class="flex items-center justify-between gap-3">
				<h2 id="deactivate-title">Deactivate your account?</h2>
				<button
					class="btn btn-square btn-ghost"
					disabled={busy}
					aria-label="Close deactivation confirmation"
					onclick={() => {
						deactivateConfirm = false;
					}}><X size={18} /></button
				>
			</div>
			<p class="user-copy mt-3">
				You will be logged out and account access will be blocked. Your profile and existing records
				will be kept.
			</p>
			<div class="user-actions">
				<button class="btn btn-primary" disabled={busy} onclick={deactivate}
					>{busy ? 'Please wait...' : 'Confirm deactivation'}</button
				><button
					class="btn btn-outline"
					disabled={busy}
					onclick={() => {
						deactivateConfirm = false;
					}}>Keep account active</button
				>
			</div>
		</section>{/if}
</div>

<style>
	.settings-screen {
		padding: 10px 0 20px;
		min-height: 620px;
	}
	.settings-list {
		margin-top: 30px;
	}
	.setting-row {
		display: flex;
		gap: 20px;
		align-items: center;
		justify-content: space-between;
		padding: 24px 0;
		border-bottom: 1px solid #484d38;
	}
	.setting-row label {
		cursor: pointer;
		flex: 1;
		min-height: 44px;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 6px;
	}
	.setting-row strong {
		font-size: 14px;
		font-weight: 500;
	}
	.setting-row span,
	.setting-row p {
		font-size: 12px;
		color: #c7cfb7;
		line-height: 1.7;
	}
	.setting-row p {
		margin-top: 6px;
	}
	.setting-row .toggle {
		flex-shrink: 0;
	}
	.view-button {
		min-width: 95px;
	}
	.settings-screen > .user-panel {
		margin-top: 22px;
	}
	.settings-screen h2 {
		font-size: 16px;
		font-weight: 500;
	}
	.account-status {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-top: 30px !important;
	}
	.deactivate-confirm {
		border: 1px solid #87745b;
		border-radius: 10px;
		padding: 18px;
		margin-top: 22px;
		background: #272219;
	}
</style>
