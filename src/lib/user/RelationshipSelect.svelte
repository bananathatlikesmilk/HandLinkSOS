<script lang="ts">
	let {
		value = $bindable(''),
		id,
		name,
		label = 'Relationship',
		required = true,
		disabled = false
	}: {
		value?: string;
		id?: string;
		name?: string;
		label?: string;
		required?: boolean;
		disabled?: boolean;
	} = $props();
	const uid = $props.id();
	const options = [
		'Parent',
		'Child',
		'Sibling',
		'Spouse/Partner',
		'Grandparent',
		'Grandchild',
		'Relative',
		'Friend',
		'Caregiver',
		'Teacher',
		'Other'
	];
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
