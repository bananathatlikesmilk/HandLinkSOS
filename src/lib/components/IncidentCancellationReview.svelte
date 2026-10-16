<script lang="ts">
	import { resolve } from '$app/paths';
	import { apiRequest } from '#lib/client/request.ts';
	import type { IncidentCancellation } from '#lib/incidents.ts';
	let {
		incidentId,
		cancellation,
		canReview,
		disabled = false,
		onBusyChange,
		onReviewed
	}: {
		incidentId: string;
		cancellation: IncidentCancellation | null;
		canReview: boolean;
		disabled?: boolean;
		onBusyChange: (busy: boolean) => void;
		onReviewed: () => Promise<void>;
	} = $props();
	let busy = $state(false);
	let error = $state('');
	async function review(decision: 'approve' | 'reject') {
		if (busy || disabled || !canReview || cancellation?.decision !== 'pending') return;
		if (
			decision === 'approve' &&
			!window.confirm(
				`Approve this cancellation and close the incident?\n\nReason: ${cancellation.reason}\n\nConfirm through your dispatch process before stopping the response.`
			)
		)
			return;
		busy = true;
		error = '';
		onBusyChange(true);
		try {
			await apiRequest(
				`${resolve('/api/staff/incidents')}/${encodeURIComponent(incidentId)}/cancellation`,
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ decision })
				}
			);
		} catch (cause) {
			error =
				cause instanceof Error
					? cause.message
					: 'Unable to review cancellation. Refresh before retrying.';
		} finally {
			busy = false;
			onBusyChange(false);
			await onReviewed();
		}
	}
</script>

{#if cancellation}
	<section
		class="my-5 space-y-3 rounded-lg border border-base-content/30 p-4"
		aria-label="Cancellation request"
		aria-busy={busy}
	>
		<h3 class="section-heading">
			{cancellation.decision === 'approved'
				? 'Cancellation approved'
				: cancellation.decision === 'rejected'
					? 'Cancellation rejected'
					: 'Cancellation requested'}
		</h3>
		<p class="text-sm break-words whitespace-pre-wrap">
			<strong>Reason:</strong>
			{cancellation.reason}
		</p>
		<p class="muted text-xs">
			Requested {new Date(cancellation.requestedAt).toLocaleString()}{#if cancellation.reviewedAt}
				· Reviewed {new Date(cancellation.reviewedAt).toLocaleString()}{/if}
		</p>
		{#if cancellation.decision === 'pending'}
			<p class="muted text-sm">
				Response continues until the assigned dispatcher reviews this request.
			</p>
			{#if canReview}
				<div class="flex flex-wrap gap-3">
					<button
						class="btn btn-outline btn-sm"
						disabled={busy || disabled}
						onclick={() => review('approve')}>Approve cancellation</button
					>
					<button
						class="btn btn-outline btn-sm"
						disabled={busy || disabled}
						onclick={() => review('reject')}>Reject cancellation</button
					>
				</div>
			{/if}
		{:else if cancellation.decision === 'approved'}
			<p class="muted text-sm">Dispatcher approved cancellation and closed this incident.</p>
		{:else}
			<p class="muted text-sm">
				Dispatcher rejected cancellation. The incident follows its response status.
			</p>
		{/if}
		{#if error}<p class="alert alert-error" role="alert">{error}</p>{/if}
	</section>
{/if}
