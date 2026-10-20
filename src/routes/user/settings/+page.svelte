<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { ChevronDown, LogOut, ShieldCheck, UserRound, X } from '@lucide/svelte';
	import { emptyProfile, getUserPreview } from '#lib/user/preview.svelte.ts';
	import { accountRequest } from '#lib/user/account.ts';
	import { disableNativeSharing } from '#lib/native/location.ts';
	import { stopFloatingButton } from '#lib/native/permissions.ts';
	import UserPermissionControls from '#lib/user/UserPermissionControls.svelte';
	import PushNotificationsControls from '#lib/user/PushNotificationsControls.svelte';
	const preview = getUserPreview();
	let privacyOpen = $state(false);
	let deactivateConfirm = $state(false);
	let busy = $state(false);
	let errorMessage = $state('');
	async function stopNativeBeforeAccountAction() {
		let warning = '';
		await stopFloatingButton().catch(() => {
			warning =
				' Floating button could not be confirmed stopped. Hide it in Settings or stop it from Android notifications.';
		});
		await disableNativeSharing().catch(() => {
			warning +=
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
	<UserPermissionControls disabled={busy} />
	<div class="settings-list">
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
				SOS saves your location and the selected profile for authorized dispatchers. You choose
				sharing recipients and duration, and can stop anytime.
			</p>
			<p class="user-copy">
				Share only what you choose. Sending SOS for someone requires their QR approval. Each
				direction needs separate approval.
			</p>
			<p class="user-copy">
				Profile changes are saved. SOS and sharing updates appear in Notifications. Android phone
				alerts require setup and permission. Calls use a separate phone system; HandLink never
				calls.
			</p>
			<p class="user-copy">Deactivation blocks access. Your profile and records are kept.</p>
		</section>{/if}
	{#key page.data.account?.id}<PushNotificationsControls disabled={busy} />{/key}
	<div class="user-notice mt-6">
		Keep this page visible for browser location updates. On Android, enable screen-off updates in
		Share location.
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
				You will be logged out and lose account access. Your profile and records will be kept.
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
		border-bottom: 1px solid var(--app-border);
	}
	.setting-row strong {
		font-size: 14px;
		font-weight: 500;
	}
	.setting-row p {
		font-size: 12px;
		color: var(--app-muted);
		line-height: 1.7;
	}
	.setting-row p {
		margin-top: 6px;
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
