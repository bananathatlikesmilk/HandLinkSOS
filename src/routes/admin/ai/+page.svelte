<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { apiRequest } from '#lib/client/request.ts';
	import type { AiProvider } from '#lib/ai-summary.ts';
	import type { PageProps } from './$types';
	let { data }: PageProps = $props();
	let settings = $state(untrack(() => data.settings));
	let selected = $state<AiProvider>(untrack(() => data.settings.selected.provider));
	let ready = $state(false);
	let busy = $state(false);
	let error = $state('');
	let notice = $state('');
	onMount(() => {
		ready = true;
	});
	async function save(event: SubmitEvent) {
		event.preventDefault();
		if (busy || !settings.providers[selected].configured) return;
		busy = true;
		error = '';
		notice = '';
		try {
			settings = await apiRequest<typeof settings>('/api/admin/ai-settings', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ provider: selected })
			});
			notice = 'AI provider saved for all dispatchers.';
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Unable to save AI settings.';
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head><title>AI settings | HandLink</title></svelte:head>
<section class="panel space-y-6" aria-labelledby="ai-settings-heading">
	<header>
		<h1 id="ai-settings-heading" class="page-heading">AI settings</h1>
		<p class="muted mt-2">Choose the summary provider for all dispatchers.</p>
	</header>
	<p>
		Current provider: <strong
			>{settings.selected.provider === 'gemini' ? 'Google Gemini' : 'Ollama'}</strong
		>
	</p>
	<form onsubmit={save}>
		<fieldset class="space-y-4" disabled={busy || !ready}>
			<label class="field-label"
				>AI provider
				<select class="select w-full" aria-label="AI provider" bind:value={selected}>
					<option value="ollama">Ollama (configured server)</option>
					<option value="gemini">Gemini (Google cloud)</option>
				</select>
			</label>
			<p class="muted">Model: {settings.providers[selected].model}</p>
			{#if selected === 'gemini'}
				<p class="alert alert-warning">
					Gemini sends dispatcher-approved notes to Google. Dispatchers must review the text and
					confirm cloud processing. Google API quotas and charges may apply.
				</p>
				<p class="muted">
					Server API key: {settings.providers.gemini.configured ? 'Configured' : 'Not configured'}.
					Set GEMINI_API_KEY in the server .env and restart the app. Keys are never displayed here.
				</p>
			{:else}
				<p class="muted">
					Uses OLLAMA_SERVER_URL from the server .env. No automatic switch to Gemini occurs.
				</p>
			{/if}
			{#if !settings.providers[selected].configured}<p role="status">
					Configure this provider on the server before selecting it.
				</p>{/if}
			<button
				class="btn btn-primary"
				type="submit"
				disabled={!settings.providers[selected].configured}
				>{busy ? 'Saving...' : 'Save AI provider'}</button
			>
		</fieldset>
	</form>
	{#if error}<p class="alert alert-error" role="alert">{error}</p>{/if}
	{#if notice}<p class="alert" role="status">{notice}</p>{/if}
</section>
