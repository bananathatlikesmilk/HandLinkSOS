<script lang="ts">
	import { resolve } from '$app/paths';
	import { ShieldCheck, UserRound } from '@lucide/svelte';

	let {
		account
	}: {
		account: { name: string; email: string; role: 'admin' | 'dispatcher' };
	} = $props();
</script>

<svelte:head>
	<title>My profile | HandLink</title>
</svelte:head>

<section class="mx-auto w-full max-w-3xl" aria-labelledby="profile-heading">
	<header class="mb-6 flex items-start gap-4">
		<div class="rounded-2xl border border-neutral-700 bg-neutral-900 p-3">
			<UserRound size={24} aria-hidden="true" />
		</div>
		<div class="min-w-0">
			<h1 id="profile-heading" class="page-heading">My profile</h1>
			<p class="muted mt-2">Your signed-in staff account details.</p>
		</div>
	</header>

	<div class="panel">
		<h2 class="text-lg font-semibold">Account information</h2>
		<dl class="mt-4 divide-y divide-neutral-700" aria-label="My account details">
			<div class="grid gap-2 py-5 sm:grid-cols-[9rem_minmax(0,1fr)]">
				<dt class="muted text-sm">Full name</dt>
				<dd class="min-w-0 font-medium wrap-anywhere">{account.name}</dd>
			</div>
			<div class="grid gap-2 py-5 sm:grid-cols-[9rem_minmax(0,1fr)]">
				<dt class="muted text-sm">Email address</dt>
				<dd class="min-w-0 wrap-anywhere">{account.email}</dd>
			</div>
			<div class="grid gap-2 py-5 sm:grid-cols-[9rem_minmax(0,1fr)]">
				<dt class="muted text-sm">Account role</dt>
				<dd>{account.role === 'admin' ? 'Administrator' : 'Dispatcher'}</dd>
			</div>
		</dl>
	</div>

	<div
		class="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-neutral-700 p-5"
	>
		<p class="muted max-w-md text-sm">
			Manage your authenticator and recovery codes in account security.
		</p>
		<a
			class="btn min-h-11 btn-outline whitespace-normal"
			href={resolve(account.role === 'admin' ? '/admin/security' : '/dispatch/security')}
		>
			<ShieldCheck size={18} aria-hidden="true" />
			Account security
		</a>
	</div>
</section>
