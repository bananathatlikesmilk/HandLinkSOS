<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { ShieldCheck } from '@lucide/svelte';

	let {
		security,
		role
	}: {
		security: { email: string; enabled: boolean; mfaVerified: boolean };
		role: 'admin' | 'dispatch';
	} = $props();
	let password = $state('');
	let code = $state('');
	let secret = $state('');
	let backupCodes = $state<string[]>([]);
	let savedCodes = $state(false);
	let replaceConfirmed = $state(false);
	let busy = $state(false);
	let error = $state('');
	let notice = $state('');

	async function request(action: string, body: Record<string, unknown>) {
		const response = await fetch(`/api/auth/two-factor/${action}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		});
		const result: unknown = await response.json().catch(() => null);
		if (!result || typeof result !== 'object') {
			throw new Error('The server could not complete this request. Try again.');
		}
		const data = result as Record<string, unknown>;
		if (!response.ok) {
			throw new Error(
				typeof data.message === 'string'
					? data.message
					: 'Unable to update account security. Try again.'
			);
		}
		return data;
	}

	function readBackupCodes(data: Record<string, unknown>) {
		if (
			!Array.isArray(data.backupCodes) ||
			!data.backupCodes.length ||
			!data.backupCodes.every((value) => typeof value === 'string')
		) {
			throw new Error('Backup codes could not be loaded. Start again.');
		}
		return data.backupCodes as string[];
	}

	async function run(action: () => Promise<void>) {
		if (busy) return;
		busy = true;
		error = '';
		notice = '';
		try {
			await action();
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Unable to connect. Try again.';
		} finally {
			password = '';
			busy = false;
		}
	}

	function startSetup(event: SubmitEvent) {
		event.preventDefault();
		void run(async () => {
			const data = await request('enable', { password });
			if (typeof data.totpURI !== 'string')
				throw new Error('Authenticator setup could not be loaded. Start again.');
			const setupSecret = new URL(data.totpURI).searchParams.get('secret');
			if (!setupSecret) throw new Error('Authenticator setup could not be loaded. Start again.');
			backupCodes = readBackupCodes(data);
			secret = setupSecret;
			savedCodes = false;
		});
	}

	function verify(event: SubmitEvent) {
		event.preventDefault();
		if (!savedCodes || !/^\d{6}$/.test(code)) return;
		void run(async () => {
			await request('verify-totp', { code, trustDevice: false });
			secret = '';
			code = '';
			backupCodes = [];
			savedCodes = false;
			await invalidateAll();
			notice = 'Authenticator verified. Your account is protected.';
		});
	}

	function replaceBackupCodes(event: SubmitEvent) {
		event.preventDefault();
		void run(async () => {
			const data = await request('generate-backup-codes', { password });
			backupCodes = readBackupCodes(data);
			savedCodes = false;
			notice = 'New backup codes created. All previous backup codes are now invalid.';
		});
	}

	function replaceAuthenticator(event: SubmitEvent) {
		event.preventDefault();
		if (!replaceConfirmed) return;
		void run(async () => {
			await request('disable', { password });
			secret = '';
			code = '';
			backupCodes = [];
			savedCodes = false;
			replaceConfirmed = false;
			await invalidateAll();
			notice = 'Set up your new authenticator below before returning to your workspace.';
		});
	}
</script>

<svelte:head><title>Account security | HandLink</title></svelte:head>

<section class="security" aria-labelledby="security-heading">
	<ShieldCheck size={28} aria-hidden="true" />
	<h1 id="security-heading">Account security</h1>
	<p class="muted">{security.email}</p>
	<p>Admins and dispatchers must use an authenticator app to access their workspace.</p>
	{#if error}<p class="message error" role="alert">{error}</p>{/if}
	{#if notice}<p class="message" role="status">{notice}</p>{/if}
	{#if !security.enabled}
		{#if !secret}
			<h2>Set up your authenticator</h2>
			<p>
				Use Google Authenticator, Microsoft Authenticator, or another app that supports time-based
				codes.
			</p>
			<form onsubmit={startSetup}>
				<label for="setup-password">Current password</label>
				<input
					id="setup-password"
					type="password"
					autocomplete="current-password"
					minlength="12"
					maxlength="128"
					required
					bind:value={password}
					disabled={busy}
				/>
				<button type="submit" disabled={busy}
					>{busy ? 'Please wait…' : 'Start authenticator setup'}</button
				>
			</form>
		{:else}
			<h2>Add HandLink to your authenticator</h2>
			<ol>
				<li>Open your authenticator app and choose to enter a setup key manually.</li>
				<li>Use HandLink ({security.email}) as the account name. Choose a time-based key.</li>
				<li>Enter this setup key. Keep it private.</li>
			</ol>
			<p class="secret" aria-label="Authenticator setup key">{secret}</p>
			<p class="muted">
				Refreshing this page clears the setup key and backup codes. Start setup again if needed.
			</p>
		{/if}
	{:else}
		<p class="message">Authenticator enabled.</p>
		{#if security.mfaVerified}
			<a class="workspace-link" href={resolve(role === 'admin' ? '/admin' : '/dispatch')}
				>Continue to workspace</a
			>
			{#if !backupCodes.length}
				<h2>Replace backup codes</h2>
				<p>
					Each backup code works once if you lose access to your phone. Creating new codes
					invalidates all previous codes.
				</p>
				<form onsubmit={replaceBackupCodes}>
					<label for="backup-password">Current password</label>
					<input
						id="backup-password"
						type="password"
						autocomplete="current-password"
						minlength="12"
						maxlength="128"
						required
						bind:value={password}
						disabled={busy}
					/>
					<button type="submit" disabled={busy}>Generate new backup codes</button>
				</form>
				<h2>Replace authenticator</h2>
				<p>
					Your existing authenticator will stop working. You must finish new setup before accessing
					your workspace again.
				</p>
				<form onsubmit={replaceAuthenticator}>
					<label for="replace-password">Current password</label>
					<input
						id="replace-password"
						type="password"
						autocomplete="current-password"
						minlength="12"
						maxlength="128"
						required
						bind:value={password}
						disabled={busy}
					/>
					<label class="check"
						><input type="checkbox" bind:checked={replaceConfirmed} disabled={busy} required />I
						understand that I must set up a new authenticator.</label
					>
					<button type="submit" disabled={busy || !replaceConfirmed}>Replace authenticator</button>
				</form>
			{/if}
		{:else}
			<p>
				Sign in again and enter an authenticator or backup code to manage your security settings.
			</p>
			<a
				class="workspace-link"
				href={resolve(role === 'admin' ? '/admin/login' : '/dispatch/login')}>Return to login</a
			>
		{/if}
	{/if}
	{#if backupCodes.length}
		<h2>Save your backup codes</h2>
		<p>
			Store these codes somewhere private, away from this device. They appear only during this
			setup. Each code can be used once.
		</p>
		<ul class="codes" aria-label="Backup codes">
			{#each backupCodes as backup (backup)}<li><code>{backup}</code></li>{/each}
		</ul>
		<label class="check"
			><input type="checkbox" bind:checked={savedCodes} disabled={busy} />I saved my backup codes
			securely.</label
		>
		{#if secret}
			<form onsubmit={verify}>
				<label for="authenticator-code">Authenticator code</label>
				<input
					id="authenticator-code"
					type="text"
					inputmode="numeric"
					autocomplete="one-time-code"
					pattern={'[0-9]{6}'}
					maxlength="6"
					minlength="6"
					required
					bind:value={code}
					disabled={busy}
				/>
				<button type="submit" disabled={busy || !savedCodes}>Verify and enable authenticator</button
				>
			</form>
		{:else}
			<button
				type="button"
				disabled={busy || !savedCodes}
				onclick={() => {
					backupCodes = [];
					savedCodes = false;
				}}>Finish saving backup codes</button
			>
		{/if}
	{/if}
</section>

<style>
	.security {
		max-width: 640px;
		margin: 0 auto;
		color: #eeeeec;
	}
	h1 {
		font-size: clamp(1.6rem, 5vw, 2rem);
		font-weight: 600;
		margin: 12px 0;
	}
	h2 {
		font-size: 1.2rem;
		font-weight: 600;
		margin: 28px 0 12px;
	}
	p,
	ol {
		line-height: 1.65;
		margin: 12px 0;
	}
	.muted {
		color: #bdbdb9;
		font-size: 0.9rem;
		overflow-wrap: anywhere;
	}
	ol {
		list-style: decimal;
		padding-left: 24px;
	}
	li {
		margin: 8px 0;
	}
	form {
		display: grid;
		gap: 12px;
		margin-top: 18px;
	}
	label {
		font-size: 0.95rem;
	}
	input:not([type='checkbox']) {
		width: 100%;
		min-height: 48px;
		border: 1px solid #777;
		border-radius: 8px;
		background: #171717;
		padding: 12px;
		color: #fff;
	}
	button,
	.workspace-link {
		min-height: 44px;
		border: 1px solid #b6b6b1;
		border-radius: 8px;
		padding: 12px 18px;
		background: #d1d1ce;
		color: #080808;
		font-weight: 600;
		text-align: center;
	}
	button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	button:not(:disabled):hover,
	.workspace-link:hover {
		background: #eee;
	}
	button:focus-visible,
	a:focus-visible,
	input:focus-visible {
		outline: 2px solid #f2b36c;
		outline-offset: 4px;
	}
	.workspace-link {
		display: inline-flex;
		align-items: center;
	}
	.message {
		padding: 12px 16px;
		border: 1px solid #777;
		border-radius: 8px;
		background: #202020;
	}
	.error {
		color: #ffd6d6;
		border-color: #b76d6d;
	}
	.secret {
		font-family: monospace;
		padding: 16px;
		border: 1px solid #777;
		border-radius: 8px;
		overflow-wrap: anywhere;
		user-select: all;
	}
	.codes {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 8px;
		list-style: none;
		padding: 12px;
		border: 1px solid #777;
		border-radius: 8px;
	}
	.codes li {
		margin: 0;
		padding: 4px;
		overflow-wrap: anywhere;
		user-select: all;
	}
	.check {
		display: flex;
		align-items: center;
		gap: 12px;
		min-height: 44px;
		line-height: 1.5;
		margin: 12px 0;
	}
	.check input {
		width: 22px;
		height: 22px;
		flex-shrink: 0;
		accent-color: #d1d1ce;
	}
</style>
