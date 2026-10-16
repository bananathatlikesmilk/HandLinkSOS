<script lang="ts">
	import StaffSecurity from '#lib/components/StaffSecurity.svelte';
	import type { PageProps } from './$types';
	let { data }: PageProps = $props();
</script>

<StaffSecurity security={data.security} role="dispatch" />
