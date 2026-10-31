<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { Camera, MapPin, PanelsTopLeft } from '@lucide/svelte';
	import {
		getPermissionStatus,
		setAccessEnabled,
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
	import { apiRequest } from '#lib/client/request.ts';
	import type { SharingState } from '#lib/sharing.ts';

	let { disabled = false }: { disabled?: boolean } = $props();
	let status = $state<UserPermissionStatus | null>(null);
	let native = $state(false);
	let working = $state(false);
	let error = $state('');
	let notice = $state('');
	let mounted = false;
	let accountId: string | undefined;
	let actionGeneration = 0;
	const unavailable = $derived(disabled || working || !status);
	// The switch owns saved app use; OS grants and hardware activity are separate states.
	const locationOn = $derived(!!status && status.locationEnabled !== false);
	const cameraOn = $derived(!!status && status.cameraEnabled !== false);
	function current() {
		return mounted && accountId === page.data.account?.id;
	}
	function accessLabel(access: AccessState | undefined, enabled = true) {
		if (!enabled) return 'Off';
		return access === 'granted'
			? 'On'
			: access === 'denied'
				? 'On · permission blocked'
				: access === 'prompt'
					? 'On · permission needed'
					: 'On · permission not checked';
	}
	async function changeAccess(kind: 'location' | 'camera', enabled: boolean) {
		if (!status) return;
		if (!enabled) {
			status = { ...status, ...(await setAccessEnabled(kind, false)) };
			if (kind === 'location') {
				try {
					const sharing = await apiRequest<SharingState>('/api/sharing');
					if (!current()) return;
					if (sharing.own?.status === 'active')
						await apiRequest(`/api/sharing/${sharing.own.id}/stop`, {
							method: 'POST',
							headers: { 'Content-Type': 'application/json' },
							body: '{}'
						});
					window.dispatchEvent(new Event('user-sharing-change'));
				} catch {
					throw new Error(
						'Location use is off. Could not end existing sharing; retry Stop sharing to remove access to the last shared point.'
					);
				}
			}
			notice = `${kind === 'camera' ? 'Camera' : 'Location'} use is off in HandLink.`;
			return status;
		}
		status = { ...status, ...(await setAccessEnabled(kind, true)) };
		const result =
			kind === 'location' && native
				? await requestLocationAccess()
				: status[kind] === 'granted'
					? status
					: await (kind === 'camera' ? requestCameraAccess() : requestLocationAccess());
		if (!current()) return;
		status = { ...status, ...result };
		if (
			kind === 'location' &&
			result.location === 'granted' &&
			result.locationServicesEnabled === false
		)
			notice = 'Phone Location is still off. Enable it in phone Settings when ready.';
		if (result[kind] !== 'granted') {
			notice = native
				? 'HandLink use is on. Allow ' + kind + ' in Android Settings.'
				: 'HandLink use is on. Allow ' + kind + ' in your browser site settings.';
			if (native) await openApplicationSettings();
		}
		return result;
	}
	async function changeOverlay() {
		if (status?.overlayActive) return stopFloatingButton();
		if (!status?.overlayAllowed) {
			await openOverlaySettings();
			if (!current()) return;
			const latest = await getPermissionStatus();
			status = latest;
			if (!latest.overlayAllowed) {
				notice = 'Allow display over other apps to show the floating button.';
				return latest;
			}
		}
		await enableFloatingButton();
	}
	async function run(action: () => Promise<UserPermissionStatus | void>) {
		if (!current() || disabled || working) return;
		working = true;
		actionGeneration++;
		error = '';
		notice = '';
		try {
			const result = await action();
			if (!current()) return;
			const latest = result ?? (await getPermissionStatus());
			if (current()) status = { ...status, ...latest };
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
		let refreshing = false;
		const refresh = async () => {
			if (!current() || document.hidden || working || disabled || refreshing) return;
			refreshing = true;
			const generation = actionGeneration;
			try {
				const latest = await getPermissionStatus();
				if (current() && !working && generation === actionGeneration) status = latest;
			} catch (cause) {
				if (current() && !status)
					error = cause instanceof Error ? cause.message : 'Could not check permissions.';
			} finally {
				refreshing = false;
			}
		};
		void refresh();
		const timer = window.setInterval(() => void refresh(), 3000);
		window.addEventListener('focus', refresh);
		document.addEventListener('visibilitychange', refresh);
		return () => {
			mounted = false;
			window.clearInterval(timer);
			window.removeEventListener('focus', refresh);
			document.removeEventListener('visibilitychange', refresh);
		};
	});
</script>

<section class="user-panel mt-6" aria-labelledby="permissions-heading" aria-busy={working}>
	<h2 id="permissions-heading" class="text-base font-medium">App permissions</h2>
	<p class="user-copy mt-2 text-sm">
		Switches save HandLink access, not whether GPS or camera is currently running. Phone permissions
		apply separately.
	</p>
	<div class="permission-row">
		<div class="permission-details">
			<MapPin size={20} aria-hidden="true" />
			<div>
				<h3>Location access</h3>
				<p>For SOS and sharing. Off ends active sharing.</p>
				{#if status?.locationServicesEnabled === false}<p class="user-error">
						Phone Location is off. Turn it on in Quick Settings or phone Settings.
					</p>
				{:else if status && status.locationServicesEnabled == null}<p>
						Phone Location cannot be checked here. Make sure it is on before SOS.
					</p>{/if}
			</div>
		</div>
		<div class="permission-control">
			<span
				class="permission-state"
				class:on={locationOn &&
					status?.locationServicesEnabled === true &&
					status?.location === 'granted'}
				>{!locationOn
					? 'Off'
					: status?.locationServicesEnabled === false
						? 'Phone Location off'
						: status?.locationServicesEnabled == null
							? 'Phone Location not checked'
							: accessLabel(status?.location, true)}</span
			><input
				type="checkbox"
				role="switch"
				aria-label="Location access"
				checked={locationOn}
				class="permission-switch"
				disabled={unavailable}
				onchange={(event) => {
					const enabled = event.currentTarget.checked;
					event.currentTarget.checked = locationOn;
					void run(() => changeAccess('location', enabled));
				}}
			/>
		</div>
	</div>
	<div class="permission-row">
		<div class="permission-details">
			<Camera size={20} aria-hidden="true" />
			<div>
				<h3>Camera access</h3>
				<p>For QR scanning.</p>
			</div>
		</div>
		<div class="permission-control">
			<span class="permission-state" class:on={cameraOn}
				>{accessLabel(status?.camera, status?.cameraEnabled !== false)}</span
			><input
				type="checkbox"
				role="switch"
				aria-label="Camera access"
				checked={cameraOn}
				class="permission-switch"
				disabled={unavailable}
				onchange={(event) => {
					const enabled = event.currentTarget.checked;
					event.currentTarget.checked = cameraOn;
					void run(() => changeAccess('camera', enabled));
				}}
			/>
		</div>
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
		<div class="permission-control">
			<span class="permission-state" class:on={status?.overlayActive}
				>{native ? (status?.overlayActive ? 'On' : 'Off') : 'Android only'}</span
			>
			<input
				type="checkbox"
				role="switch"
				aria-label="Display over other apps"
				checked={status?.overlayActive ?? false}
				class="permission-switch"
				disabled={unavailable || !native}
				onchange={(event) => {
					event.currentTarget.checked = status?.overlayActive ?? false;
					void run(changeOverlay);
				}}
			/>
		</div>
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
	{#if notice}<p class="user-copy mt-3 text-sm" role="status">{notice}</p>{/if}
	{#if error}<p class="user-error mt-3" role="alert">{error}</p>{/if}
</section>

<style>
	.permission-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		border-bottom: 1px solid var(--app-border);
		padding-block: 20px;
	}
	.permission-details {
		display: flex;
		align-items: flex-start;
		gap: 12px;
		flex: 1 1 150px;
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
		color: var(--app-muted);
	}
	.permission-control {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.permission-state {
		font-size: 14px;
		font-weight: 650;
		color: var(--app-muted);
	}
	.permission-state.on {
		color: var(--app-accent);
	}
	.permission-switch {
		appearance: none;
		width: 64px;
		height: 40px;
		min-height: 40px;
		margin-block: 4px;
		padding: 6px;
		border: 2px solid var(--app-border);
		border-radius: 999px;
		background: var(--app-surface-alt);
		display: flex;
		align-items: center;
		cursor: pointer;
		flex-shrink: 0;
	}
	.permission-switch::before {
		content: '';
		display: block;
		flex-shrink: 0;
		width: 28px;
		height: 28px;
		background: var(--app-muted);
		border-radius: 50%;
		transition: transform 150ms;
	}
	.permission-switch:checked {
		background: var(--app-accent);
		border-color: var(--app-accent);
	}
	.permission-switch:checked::before {
		transform: translateX(20px);
		background: var(--app-accent-text);
	}
	.permission-switch:disabled {
		cursor: not-allowed;
		opacity: 0.6;
	}
	button {
		min-height: 44px;
		max-width: 100%;
		white-space: normal;
	}
</style>
