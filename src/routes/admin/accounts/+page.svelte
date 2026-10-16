<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { Check, Mail, Plus, Search, X } from '@lucide/svelte';
	import type { PageProps } from './$types';
	let { data }: PageProps = $props();
	type Account = (typeof data.accounts)[number];
	function createDialog() {
		return document.getElementById('create-account-dialog') as HTMLDialogElement;
	}
	function statusDialog() {
		return document.getElementById('account-status-dialog') as HTMLDialogElement;
	}
	let name = $state('');
	let email = $state('');
	let password = $state('');
	let role = $state<'dispatcher' | 'admin'>('dispatcher');
	let busy = $state(false);
	let error = $state('');
	let formError = $state('');
	let statusError = $state('');
	let notice = $state('');
	let createdAccount = $state<Account | null>(null);
	let selectedAccount = $state<Account | null>(null);
	const totalPages = $derived(Math.max(1, Math.ceil(data.total / data.pageSize)));
	function pageHref(pageNumber: number) {
		const query = new URLSearchParams({
			search: data.search,
			role: data.role,
			page: String(pageNumber)
		});
		return `/admin/accounts?${query}` as const;
	}
	async function request(url: string, method: 'POST' | 'PATCH', body: object) {
		let response: Response;
		try {
			response = await fetch(url, {
				method,
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});
		} catch {
			throw new Error(
				'Connection interrupted. Refresh accounts to check the result before trying again.'
			);
		}
		const result = await response.json().catch(() => null);
		if (!response.ok) throw new Error(result?.message ?? 'Request failed. Try again.');
		return result as { account: Account };
	}
	async function refreshSavedAccounts() {
		try {
			await invalidateAll();
		} catch {
			error = 'Changes were saved, but the list could not refresh. Reload this page.';
		}
	}
	function openCreate() {
		formError = '';
		createdAccount = null;
		name = '';
		email = '';
		password = '';
		role = 'dispatcher';
		createDialog().showModal();
	}
	async function createAccount(event: SubmitEvent) {
		event.preventDefault();
		if (busy) return;
		busy = true;
		formError = '';
		error = '';
		try {
			const result = await request(resolve('/api/admin/accounts'), 'POST', {
				name: name.trim(),
				email: email.trim(),
				password,
				role
			});
			password = '';
			createdAccount = result.account;
			notice = `${result.account.role === 'admin' ? 'Admin' : 'Dispatcher'} account saved for ${result.account.email}. Email verification and authenticator setup are required before workspace access.`;
			await refreshSavedAccounts();
		} catch (cause) {
			formError = cause instanceof Error ? cause.message : 'Unable to create account.';
		} finally {
			busy = false;
		}
	}
	async function sendVerification(account: Account) {
		if (busy) return;
		busy = true;
		error = '';
		formError = '';
		try {
			await request(
				resolve('/api/admin/accounts/[id]/verification', { id: account.id }),
				'POST',
				{}
			);
			notice = `Verification email sent to ${account.email}. Ask the account holder to check their inbox and spam folder.`;
			if (createDialog().open) createDialog().close();
		} catch (cause) {
			const message = cause instanceof Error ? cause.message : 'Unable to send verification email.';
			if (createDialog().open) formError = `Account is saved. Email delivery failed: ${message}`;
			else error = message;
		} finally {
			busy = false;
		}
	}
	function confirmStatus(account: Account) {
		selectedAccount = account;
		statusError = '';
		statusDialog().showModal();
	}
	async function changeStatus() {
		if (busy || !selectedAccount) return;
		busy = true;
		statusError = '';
		error = '';
		try {
			await request(resolve('/api/admin/accounts/[id]', { id: selectedAccount.id }), 'PATCH', {
				active: !selectedAccount.active
			});
			notice = `${selectedAccount.name} ${selectedAccount.active ? 'deactivated' : 'reactivated'}.`;
			statusDialog().close();
			await refreshSavedAccounts();
		} catch (cause) {
			statusError = cause instanceof Error ? cause.message : 'Unable to update account.';
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head><title>Manage accounts · HandLink</title></svelte:head>
<div class="space-y-6" aria-busy={busy}>
	<header class="flex flex-wrap items-start justify-between gap-4">
		<div>
			<h1 class="page-heading">Manage accounts</h1>
			<p class="muted mt-2">
				Create admins or dispatchers and manage account access. Records stay saved when an account
				is deactivated.
			</p>
		</div>
		<button class="btn btn-primary" onclick={openCreate} disabled={busy}
			><Plus size={18} /> Create staff account</button
		>
	</header>
	{#if notice}<p class="alert" role="status"><Check size={18} /><span>{notice}</span></p>{/if}
	{#if error}<p class="error-message" role="alert">{error}</p>{/if}
	{#if !data.emailConfigured}<p class="muted">
			Email delivery is unavailable. Accounts can be saved; send verification codes after email
			delivery is configured.
		</p>{/if}
	<section class="panel" aria-labelledby="accounts-heading">
		<div class="mb-5 space-y-4">
			<h2 id="accounts-heading" class="section-heading">
				Accounts <span class="muted">({data.total})</span>
			</h2>
			<form method="GET" action={resolve('/admin/accounts')} class="flex flex-wrap items-end gap-3">
				<label class="field-label search-field"
					>Search accounts<span class="input w-full"
						><Search size={17} /><input
							name="search"
							maxlength="100"
							value={data.search}
							placeholder="Name or email"
						/></span
					></label
				>
				<label class="field-label"
					>Role<select class="select" name="role" value={data.role}
						><option value="all">All roles</option><option value="user">User</option><option
							value="dispatcher">Dispatcher</option
						><option value="admin">Admin</option></select
					></label
				>
				<button class="btn btn-outline" type="submit">Search</button>
				<a class="btn btn-ghost" href={resolve('/admin/accounts')}>Clear filters</a>
			</form>
		</div>
		<div class="overflow-x-auto">
			<table class="table">
				<thead
					><tr
						><th scope="col">Account</th><th scope="col">Role</th><th scope="col">Access</th><th
							scope="col">Email</th
						><th scope="col">Actions</th></tr
					></thead
				>
				<tbody
					>{#each data.accounts as account (account.id)}<tr>
							<td
								><strong class="block text-sm"
									>{account.name}{#if account.id === data.currentUserId}
										<span class="muted">(You)</span>{/if}</strong
								><span class="text-sm text-slate-400">{account.email}</span></td
							>
							<td class="capitalize">{account.role}</td>
							<td
								><span class="badge badge-ghost">{account.active ? 'Active' : 'Inactive'}</span></td
							>
							<td>{account.emailVerified ? 'Verified' : 'Unverified'}</td>
							<td
								><div class="flex flex-wrap gap-2">
									<button
										class="btn btn-outline btn-sm"
										disabled={busy || account.id === data.currentUserId}
										aria-label={`${account.active ? 'Deactivate' : 'Reactivate'} ${account.email}`}
										onclick={() => confirmStatus(account)}
										>{account.active ? 'Deactivate' : 'Reactivate'}</button
									>
									{#if !account.emailVerified && account.active}<button
											class="btn btn-ghost btn-sm"
											disabled={busy || !data.emailConfigured}
											aria-label={`Send verification code to ${account.email}`}
											onclick={() => sendVerification(account)}
											><Mail size={16} /> Send verification code</button
										>{/if}
								</div></td
							>
						</tr>{:else}<tr
							><td colspan="5" class="py-10 text-center">No accounts match these filters.</td></tr
						>{/each}</tbody
				>
			</table>
		</div>
		<nav class="mt-5 flex flex-wrap items-center justify-between gap-3" aria-label="Account pages">
			<p class="muted text-sm">Page {data.page} of {totalPages} · {data.total} matching accounts</p>
			<div class="flex gap-2">
				{#if data.page > 1}<a class="btn btn-outline btn-sm" href={resolve(pageHref(data.page - 1))}
						>Previous</a
					>{/if}{#if data.page < totalPages}<a
						class="btn btn-outline btn-sm"
						href={resolve(pageHref(data.page + 1))}>Next</a
					>{/if}
			</div>
		</nav>
	</section>
	<p class="muted text-sm">
		Staff verify their email at <a class="link" href={resolve('/user/verify')}>email verification</a
		>, then use <a class="link" href={resolve('/admin/login')}>Admin login</a> or
		<a class="link" href={resolve('/dispatch/login')}>Dispatcher login</a> and set up an authenticator.
	</p>
	<p class="muted text-sm">
		You cannot deactivate your own account. The last active, verified admin is protected from
		deactivation.
	</p>
</div>

<dialog
	id="create-account-dialog"
	class="modal"
	aria-labelledby="create-heading"
	oncancel={(event) => {
		if (busy) event.preventDefault();
	}}
	onclose={() => {
		password = '';
	}}
>
	<div class="modal-box">
		<div class="flex items-center justify-between gap-3">
			<h2 id="create-heading" class="text-xl font-semibold">
				{createdAccount
					? `${createdAccount.role === 'admin' ? 'Admin' : 'Dispatcher'} account saved`
					: 'Create staff account'}
			</h2>
			<button
				class="btn btn-square btn-ghost"
				aria-label="Close account form"
				disabled={busy}
				onclick={() => createDialog().close()}><X size={20} /></button
			>
		</div>
		{#if createdAccount}
			<p class="muted mt-4">
				{createdAccount.email} is saved. Send an email verification code before they sign in.
			</p>
			<p class="muted mt-3 text-sm">
				Ask the {createdAccount.role === 'admin' ? 'admin' : 'dispatcher'} to verify at /user/verify,
				then sign in at
				{createdAccount.role === 'admin' ? '/admin/login' : '/dispatch/login'}. Authenticator setup
				is required before workspace access.
			</p>
			{#if formError}<p class="error-message mt-4" role="alert">{formError}</p>{/if}
			<div class="mt-6 flex flex-wrap justify-end gap-3">
				<button class="btn btn-ghost" disabled={busy} onclick={() => createDialog().close()}
					>Done</button
				><button
					class="btn btn-primary"
					disabled={busy || !data.emailConfigured}
					onclick={() => createdAccount && sendVerification(createdAccount)}
					><Mail size={17} />{busy ? 'Sending…' : 'Send verification code'}</button
				>
			</div>
		{:else}
			<p class="muted mt-3 text-sm">
				Choose the staff role. Admins can manage accounts. Share the initial password privately with
				the account holder. Email verification and authenticator setup are required.
			</p>
			<form class="mt-6 space-y-4" onsubmit={createAccount}>
				<fieldset class="space-y-4" disabled={busy}>
					<label class="field-label"
						>Account role<select class="select w-full" name="role" bind:value={role} required>
							<option value="dispatcher">Dispatcher</option>
							<option value="admin">Admin</option>
						</select></label
					>
					<label class="field-label"
						>Full name<input
							class="input w-full"
							name="name"
							required
							maxlength="100"
							autocomplete="name"
							bind:value={name}
						/></label
					>
					<label class="field-label"
						>Email address<input
							class="input w-full"
							name="email"
							type="email"
							required
							maxlength="254"
							autocomplete="off"
							bind:value={email}
						/></label
					>
					<label class="field-label"
						>Initial password<input
							class="input w-full"
							name="password"
							type="password"
							required
							minlength="12"
							maxlength="128"
							autocomplete="new-password"
							aria-describedby="password-help"
							bind:value={password}
						/></label
					>
					<p id="password-help" class="muted text-sm">Use 12–128 characters.</p>
					{#if formError}<p class="error-message" role="alert">{formError}</p>{/if}
					<div class="flex justify-end gap-3 pt-3">
						<button class="btn btn-ghost" type="button" onclick={() => createDialog().close()}
							>Cancel</button
						><button class="btn btn-primary" type="submit"
							>{busy ? 'Creating…' : 'Create staff account'}</button
						>
					</div>
				</fieldset>
			</form>
		{/if}
	</div>
</dialog>

<dialog
	id="account-status-dialog"
	class="modal"
	aria-labelledby="status-heading"
	oncancel={(event) => {
		if (busy) event.preventDefault();
	}}
>
	<div class="modal-box">
		<h2 id="status-heading" class="text-xl font-semibold">
			{selectedAccount?.active ? 'Deactivate' : 'Reactivate'} account?
		</h2>
		<p class="muted mt-4">{selectedAccount?.email}</p>
		<p class="mt-3 text-sm">
			{selectedAccount?.active
				? 'This stops account access and ends existing sessions. Saved records will remain.'
				: 'This restores account access. Email verification is still required before login.'}
		</p>
		{#if statusError}<p class="error-message mt-4" role="alert">{statusError}</p>{/if}
		<div class="mt-6 flex justify-end gap-3">
			<button class="btn btn-ghost" disabled={busy} onclick={() => statusDialog().close()}
				>Cancel</button
			><button class="btn btn-primary" disabled={busy} onclick={changeStatus}
				>{busy
					? 'Saving…'
					: selectedAccount?.active
						? 'Deactivate account'
						: 'Reactivate account'}</button
			>
		</div>
	</div>
</dialog>

<style>
	.search-field {
		flex: 1 1 230px;
	}
	.error-message {
		border: 1px solid #a96969;
		border-radius: 8px;
		background: #2b1b1b;
		padding: 12px 16px;
		color: #ffd1d1;
		font-size: 14px;
	}
	td {
		overflow-wrap: anywhere;
	}
</style>
