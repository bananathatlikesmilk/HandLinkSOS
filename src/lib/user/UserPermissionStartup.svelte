<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { requestInitialPermissions, stopFloatingButton } from '#lib/native/permissions.ts';

	let { accountId }: { accountId: string } = $props();
	let warning = $state('');
	onMount(() => {
		let stopped = false;
		const owner = accountId;
		void requestInitialPermissions()
			.then((status) => {
				if (stopped || owner !== page.data.account?.id) return;
				if (status.location !== 'granted' || status.camera !== 'granted')
					warning =
						'Some permissions are unavailable. Review location and camera access in Settings.';
			})
			.catch(() => {
				if (!stopped && owner === page.data.account?.id)
					warning =
						'Permissions could not be checked. Review access in Settings when you are ready.';
			});
		return () => {
			stopped = true;
			void stopFloatingButton().catch(() => {});
		};
	});
</script>

{#if warning}
	<div class="mx-6 my-3 rounded-xl border border-[#61674f] p-4 text-sm" role="status">
		<p>{warning}</p>
		<a class="btn mt-2 min-h-11 btn-ghost btn-sm" href={resolve('/user/settings')}
			>Review permissions</a
		>
	</div>
{/if}
