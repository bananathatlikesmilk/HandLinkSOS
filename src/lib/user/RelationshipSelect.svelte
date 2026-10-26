<script lang="ts">
	import { relationshipOptions } from '#lib/relationships.ts';

	let {
		value = $bindable(''),
		id,
		name,
		label = 'Relationship',
		required = true,
		disabled = false,
		options = relationshipOptions
	}: {
		value?: string;
		id?: string;
		name?: string;
		label?: string;
		required?: boolean;
		disabled?: boolean;
		options?: readonly string[];
	} = $props();
	const uid = $props.id();
</script>

<label class="user-field" for={id ?? uid}>
	<span
		>{label}{#if required}<span aria-hidden="true"> *</span>{/if}</span
	>
	<select
		id={id ?? uid}
		aria-label={label}
		{name}
		class="select w-full"
		bind:value
		{required}
		{disabled}
	>
		<option value="" disabled>Select relationship</option>
		{#if value && !options.includes(value)}<option {value}>{value}</option>{/if}
		{#each options as option (option)}<option value={option}>{option}</option>{/each}
	</select>
</label>
