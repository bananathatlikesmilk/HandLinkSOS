<script lang="ts">
	import { untrack } from 'svelte';
	import { apiRequest } from '#lib/client/request.ts';
	import type { PageProps } from './$types';
	let { data }: PageProps = $props();
	let number = $state(untrack(() => data.number));
	let savedNumber = $state(untrack(() => data.number));
	let busy = $state(false);
	let error = $state('');
	let notice = $state('');
	async function save(event: SubmitEvent) {
		event.preventDefault();
		if (busy) return;
		busy = true;
		error = '';
		notice = '';
		try {
			const result = await apiRequest<{ number: string }>('/api/admin/emergency-phone', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ number })
			});
			number = savedNumber = result.number;
			notice = 'SOS phone number saved. Newly opened call screens use this number.';
		} catch (reason) {
			error = reason instanceof Error ? reason.message : 'Could not save phone number.';
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head><title>SOS phone number | HandLink</title></svelte:head>
<section class="panel space-y-6" aria-labelledby="phone-heading">
	<h1 id="phone-heading" class="page-heading">SOS phone number</h1>
	<p>Current number: <strong>{savedNumber}</strong></p>
	<p class="muted">
		Choose the official number users should contact after SOS. This applies system-wide. Users must
		press Call in their phone dialer.
	</p>
	<form class="space-y-4" onsubmit={save}>
		<label class="field-label"
			>SOS phone number *<input
				type="tel"
				class="input w-full"
				bind:value={number}
				required
				maxlength="16"
				pattern={'\\+?[0-9]{3,15}'}
				aria-describedby="phone-format"
				disabled={busy}
			/></label
		>
		<p id="phone-format" class="muted">
			Enter 3–15 digits, optionally starting with +. Include the area or country code when needed.
		</p>
		<button class="btn btn-primary" disabled={busy}
			>{busy ? 'Saving…' : 'Save SOS phone number'}</button
		>
	</form>
	{#if error}<p class="alert alert-error" role="alert">{error}</p>{/if}
	{#if notice}<p class="alert" role="status">{notice}</p>{/if}
</section>
