<script lang="ts">
	import StaffProfile from '#lib/components/StaffProfile.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

{#if data.account?.role === 'admin'}
	<StaffProfile account={{ name: data.account.name, email: data.account.email, role: 'admin' }} />
{/if}
