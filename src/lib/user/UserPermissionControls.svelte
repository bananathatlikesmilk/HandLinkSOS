<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { Camera, MapPin, PanelsTopLeft } from '@lucide/svelte';
	import {
		getPermissionStatus,
		nativePermissionsAvailable,
		openApplicationSettings,
		openOverlaySettings,
		requestCameraAccess,
		requestLocationAccess,
		startFloatingButton,
		stopFloatingButton,
		type AccessState,
		type UserPermissionStatus
	} from '#lib/native/permissions.ts';

	let { disabled = false }: { disabled?: boolean } = $props();
	let status = $state<UserPermissionStatus | null>(null);
	let native = $state(false);
	let working = $state(false);
	let error = $state('');
	let mounted = false;
	let accountId: string | undefined;
	const unavailable = $derived(disabled || working || !status);
	function current() {
		return mounted && accountId === page.data.account?.id;
	}
	function accessLabel(access: AccessState | undefined) {
		return access === 'granted'
			? 'Allowed'
			: access === 'denied'
				? 'Not allowed'
				: access === 'prompt'
					? 'Not requested'
					: 'Not checked';
	}
	async function run(action: () => Promise<UserPermissionStatus | void>) {
		if (!current() || disabled || working) return;
		working = true;
		error = '';
		try {
			const result = await action();
			if (!current()) return;
			const latest = result ?? (await getPermissionStatus());
			if (current()) status = latest;
		} catch (cause) {
			if (current())
				error = cause instanceof Error ? cause.message : 'Could not check permissions. Try again.';
		} finally {
			if (current()) working = false;
		}
	}
	async function enableFloatingButton() {
		await startFloatingButton();
		if (!current() || disabled) await stopFloatingButton();
	}
	onMount(() => {
		mounted = true;
		accountId = page.data.account?.id;
		native = nativePermissionsAvailable();
		const refresh = () => {
			if (!document.hidden) void run(getPermissionStatus);
		};
		refresh();
		window.addEventListener('focus', refresh);
		document.addEventListener('visibilitychange', refresh);
		return () => {
			mounted = false;
			window.removeEventListener('focus', refresh);
			document.removeEventListener('visibilitychange', refresh);
		};
	});
</script>

<section class="user-panel mt-6" aria-labelledby="permissions-heading" aria-busy={working}>
	<h2 id="permissions-heading" class="text-base font-medium">App permissions</h2>
	<p class="user-copy mt-2 text-sm">Manage location, camera, and the floating button.</p>
	<div class="permission-row">
		<div class="permission-details">
			<MapPin size={20} aria-hidden="true" />
			<div>
				<h3>Location access</h3>
				<p>{accessLabel(status?.location)}. For SOS and sharing.</p>
			</div>
		</div>
		<button
			class="btn btn-outline btn-sm"
			disabled={unavailable}
			onclick={() => run(requestLocationAccess)}>Allow location</button
		>
	</div>
	<div class="permission-row">
		<div class="permission-details">
			<Camera size={20} aria-hidden="true" />
			<div>
				<h3>Camera access</h3>
				<p>{accessLabel(status?.camera)}. For QR scanning.</p>
			</div>
		</div>
		<button
			class="btn btn-outline btn-sm"
			disabled={unavailable}
			onclick={() => run(requestCameraAccess)}>Allow camera</button
		>
	</div>
	<div class="permission-row">
		<div class="permission-details">
			<PanelsTopLeft size={20} aria-hidden="true" />
			<div>
				<h3>Display over other apps</h3>
				<p>
					{native
						? status?.overlayAllowed
							? 'Permission allowed.'
							: 'Permission not allowed.'
						: 'Available in the Android app only.'}
				</p>
				<p>Dashboard shortcut only. No SOS or calls. Hide from Settings or its notification.</p>
				{#if native}<p>
						Floating button: {status?.overlayActive ? 'On' : 'Off'}. Notifications required.
					</p>{/if}
			</div>
		</div>
		{#if native}
			<div class="flex flex-wrap gap-2">
				{#if !status?.overlayAllowed}<button
						class="btn btn-outline btn-sm"
						disabled={unavailable}
						onclick={() => run(openOverlaySettings)}>Allow display over apps</button
					>{/if}
				{#if status?.overlayActive}
					<button
						class="btn btn-outline btn-sm"
						disabled={unavailable}
						onclick={() => run(stopFloatingButton)}>Hide floating button</button
					>
				{:else}
					<button
						class="btn btn-outline btn-sm"
						disabled={unavailable || !status?.overlayAllowed}
						onclick={() => run(enableFloatingButton)}>Enable floating button</button
					>
				{/if}
			</div>
		{/if}
	</div>
	<div class="mt-4 flex flex-wrap gap-2">
		<button
			class="btn btn-outline btn-sm"
			disabled={disabled || working}
			onclick={() => run(getPermissionStatus)}
			>{working ? 'Checking permissions...' : 'Refresh permissions'}</button
		>
		{#if native}<button
				class="btn btn-ghost btn-sm"
				disabled={disabled || working}
				onclick={() => run(openApplicationSettings)}>Open app settings</button
			>{:else}<p class="user-copy text-xs">
				Blocked? Allow access in your browser's site settings.
			</p>{/if}
	</div>
	{#if status?.message}<p class="user-copy mt-3 text-sm" role="status">{status.message}</p>{/if}
	{#if error}<p class="user-error mt-3" role="alert">{error}</p>{/if}
</section>

<style>
	.permission-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		border-bottom: 1px solid #484d38;
		padding-block: 20px;
	}
	.permission-details {
		display: flex;
		align-items: flex-start;
		gap: 12px;
		flex: 1 1 220px;
		min-width: 0;
	}
	.permission-details :global(svg) {
		flex-shrink: 0;
		margin-top: 2px;
	}
	h3 {
		font-size: 14px;
		font-weight: 500;
	}
	.permission-details p {
		margin-top: 6px;
		font-size: 12px;
		line-height: 1.7;
		color: #c7cfb7;
	}
	button {
		min-height: 44px;
		max-width: 100%;
		white-space: normal;
	}
</style>
