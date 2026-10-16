<script lang="ts">
	import { onDestroy } from 'svelte';
	import { resolve } from '$app/paths';
	import { apiRequest, ApiRequestError } from '#lib/client/request.ts';
	import type { AiSummaryState } from '#lib/ai-summary.ts';
	let {
		incidentId,
		ai,
		canManage,
		disabled = false,
		onBusyChange,
		onChanged
	}: {
		incidentId: string;
		ai: AiSummaryState;
		canManage: boolean;
		disabled?: boolean;
		onBusyChange: (value: boolean) => void;
		onChanged: () => Promise<void>;
	} = $props();
	let busy = $state(false);
	let error = $state('');
	let notice = $state('');
	let preview = $state<{ sourceNoteId: string; text: string; warnings: string[] } | null>(null);
	let approvedText = $state('');
	let confirmed = $state(false);
	let requestId = '';
	let requestText = '';
	let requestSource = '';
	let controller: AbortController | undefined;
	let disposed = false;
	const base = $derived(`${resolve('/api/staff/reports/[id]', { id: incidentId })}/summary`);
	function textChanged(value: string) {
		approvedText = value;
		confirmed = false;
		requestId = '';
	}
	async function perform(action: 'preview' | 'generate' | 'review') {
		if (busy || disabled || !canManage) return;
		if (
			action === 'generate' &&
			(!ai.configured || !preview || !confirmed || !approvedText.trim() || ai.generationPending)
		)
			return;
		if (
			action === 'review' &&
			(!ai.summary?.requestId ||
				ai.summary.isStale ||
				ai.summary.reviewedAt ||
				ai.generationPending)
		)
			return;
		if (
			action === 'generate' &&
			ai.summary &&
			!window.confirm(
				'Generate a replacement draft? The current summary will be replaced; previous versions remain in the audit record.'
			)
		)
			return;
		busy = true;
		error = '';
		notice = '';
		onBusyChange(true);
		const current = new AbortController();
		controller = current;
		try {
			if (action === 'preview') {
				const result = await apiRequest<NonNullable<typeof preview>>(`${base}/preview`, {
					signal: current.signal
				});
				if (disposed || current.signal.aborted) return;
				preview = result;
				textChanged(result.text);
			} else {
				let body: unknown;
				if (action === 'generate' && preview) {
					const text = approvedText.trim();
					if (!requestId || requestText !== text || requestSource !== preview.sourceNoteId) {
						requestId = crypto.randomUUID();
						requestText = text;
						requestSource = preview.sourceNoteId;
					}
					body = {
						requestId,
						sourceNoteId: preview.sourceNoteId,
						approvedText: text,
						confirmed: true
					};
				} else body = { requestId: ai.summary?.requestId, confirmed: true };
				await apiRequest<AiSummaryState>(
					action === 'review' ? `${base}/review` : base,
					{
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify(body),
						signal: current.signal
					},
					action === 'generate' ? 100000 : undefined
				);
				if (disposed || current.signal.aborted) return;
				notice =
					action === 'review'
						? 'Summary approved.'
						: 'AI draft generated. Verify the summary before approving it.';
				if (action === 'generate') {
					confirmed = false;
					requestId = '';
				}
			}
		} catch (cause) {
			if (
				action === 'generate' &&
				cause instanceof ApiRequestError &&
				[502, 503, 422].includes(cause.status)
			)
				requestId = '';
			if (!disposed && !current.signal.aborted)
				error = cause instanceof Error ? cause.message : 'Unable to update AI summary. Try again.';
		} finally {
			if (!disposed && controller === current) {
				busy = false;
				onBusyChange(false);
				if (action !== 'preview') await onChanged();
			}
		}
	}
	onDestroy(() => {
		disposed = true;
		controller?.abort();
		if (busy) onBusyChange(false);
	});
</script>

<section
	class="my-6 space-y-4 rounded-lg border border-base-content/30 p-4"
	aria-label="AI report summary"
	aria-busy={busy || ai.generationPending}
>
	<h3 class="section-heading">AI report summary</h3>
	<p class="muted text-sm">
		AI may be wrong. Verify every statement against dispatcher notes. This summary does not provide
		a diagnosis or treatment advice.
	</p>
	{#if ai.summary}
		<div class="space-y-3">
			<p class="badge badge-outline">
				{ai.summary.reviewedAt ? 'Dispatcher-reviewed AI summary' : 'AI-generated draft'}
			</p>
			<p class="text-sm break-words whitespace-pre-wrap">{ai.summary.summary}</p>
			<p class="muted text-xs">
				Generated {new Date(ai.summary.generatedAt).toLocaleString()}{#if ai.summary.model}
					· {ai.summary.model}{/if}
			</p>
			{#if ai.summary.reviewedAt}<p class="muted text-xs">
					Approved {new Date(ai.summary.reviewedAt).toLocaleString()}
				</p>{/if}
			{#if ai.summary.isStale}<p class="alert alert-warning" role="status">
					Incident notes changed. Generate and review a new summary.
				</p>{/if}
			{#if canManage && ai.summary.requestId && !ai.summary.reviewedAt && !ai.summary.isStale}
				<button
					class="btn btn-outline btn-sm"
					disabled={busy || disabled || ai.generationPending}
					onclick={() => perform('review')}>Approve summary</button
				>
			{/if}
		</div>
	{:else}<p class="muted text-sm">No AI summary generated yet.</p>{/if}
	{#if !ai.configured}<p class="muted text-sm">
			Local AI setup needed. Configure the server's Ollama summary model to generate summaries.
			Saved reports remain available.
		</p>{/if}
	{#if ai.generationPending}<p role="status" class="muted text-sm">
			AI generation is in progress. Refreshing this report will check its status.
		</p>{/if}
	{#if canManage}
		<p class="muted text-sm">
			Only the approved text below is processed by Ollama on the HandLink server. It is not sent to
			an external AI service. Registered medical records, contacts, and location are not included
			automatically. Remove any remaining identifying or unnecessary private information.
		</p>
		<details class="muted text-sm">
			<summary class="cursor-pointer">Local AI setup</summary>
			<p class="mt-2">
				Install and start Ollama on the HandLink server computer. Download the default model with
				<code>ollama pull qwen2.5:3b</code>. Keep Ollama running while generating summaries. No API
				key is needed. The first generation may take longer while the model loads.
			</p>
		</details>
		<button
			class="btn btn-outline btn-sm"
			disabled={busy || disabled || !ai.configured || ai.generationPending}
			onclick={() => perform('preview')}
			>{preview ? 'Reload notes preview' : 'Prepare notes for AI'}</button
		>
		{#if preview}
			{#each preview.warnings as warning, index (index)}<p class="muted text-sm">
					{warning}
				</p>{/each}
			<label class="field-label"
				>Notes approved for AI
				<textarea
					class="textarea min-h-40 w-full"
					value={approvedText}
					disabled={busy || disabled}
					maxlength="2000"
					oninput={(event) => textChanged(event.currentTarget.value)}></textarea>
			</label>
			<p class="muted text-sm">
				Only delete identifying or unnecessary text. Do not add or rewrite text. Correct the
				incident notes first if information is wrong.
			</p>
			<label class="flex items-start gap-3 text-sm">
				<input
					type="checkbox"
					class="checkbox mt-1 shrink-0 checkbox-sm"
					bind:checked={confirmed}
					disabled={busy || disabled}
				/>
				<span>I reviewed this text and removed identifying or unnecessary private information</span>
			</label>
			<p class="muted text-xs">
				Generating again replaces the current summary. Previous versions remain in the audit record.
			</p>
			<button
				class="btn btn-primary btn-sm"
				disabled={busy ||
					disabled ||
					!ai.configured ||
					ai.generationPending ||
					!confirmed ||
					!approvedText.trim()}
				onclick={() => perform('generate')}>{busy ? 'Working…' : 'Generate AI draft'}</button
			>
		{/if}
	{/if}
	{#if error}<p class="alert alert-error" role="alert">{error}</p>{/if}
	{#if notice}<p class="alert" role="status">{notice}</p>{/if}
</section>
