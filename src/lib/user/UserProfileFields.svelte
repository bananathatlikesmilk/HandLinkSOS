<script lang="ts">
	import { Plus, Trash2 } from '@lucide/svelte';
	import { onMount } from 'svelte';
	import { localPhone } from '#lib/phone.ts';
	import RelationshipSelect from './RelationshipSelect.svelte';
	import type { UserProfile } from './preview.svelte.ts';
	let {
		profile = $bindable(),
		section = 'all'
	}: { profile: UserProfile; section?: 'personal' | 'medical' | 'contacts' | 'all' } = $props();
	const uid = $props.id();
	let ready = $state(false);
	const today = new Intl.DateTimeFormat('en-CA', {
		timeZone: 'Asia/Manila',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).format(new Date());
	onMount(() => {
		if (!profile.phone) profile.phone = '09';
		for (const contact of profile.contacts) {
			if (!contact.phone) contact.phone = '09';
		}
		ready = true;
	});
	function normalizePhone(event: Event, assign: (value: string) => void) {
		const input = event.currentTarget as HTMLInputElement;
		const normalized = localPhone(input.value).slice(0, 11);
		assign(normalized);
		input.value = normalized;
	}
	function addContact() {
		profile.contacts.push({
			id: crypto.randomUUID(),
			firstName: '',
			lastName: '',
			phone: '09',
			email: '',
			relationship: ''
		});
	}
</script>

{#if section === 'personal' || section === 'all'}
	<fieldset class="profile-section" disabled={!ready}>
		<legend>Personal information</legend>
		<div class="profile-grid">
			<label class="user-field" for="{uid}-first"
				><span>First name<span aria-hidden="true"> *</span></span><input
					id="{uid}-first"
					aria-label="First name"
					class="input"
					bind:value={profile.firstName}
					autocomplete="given-name"
					required
					maxlength="60"
				/></label
			>
			<label class="user-field" for="{uid}-last"
				><span>Last name<span aria-hidden="true"> *</span></span><input
					id="{uid}-last"
					aria-label="Last name"
					class="input"
					bind:value={profile.lastName}
					autocomplete="family-name"
					required
					maxlength="60"
				/></label
			>
			<label class="user-field" for="{uid}-birth"
				><span>Birthday<span aria-hidden="true"> *</span></span><input
					id="{uid}-birth"
					aria-label="Birthday"
					type="date"
					class="input"
					bind:value={profile.birthday}
					autocomplete="bday"
					max={today}
					required
				/></label
			>
			<label class="user-field" for="{uid}-sex"
				><span>Sex<span aria-hidden="true"> *</span></span><select
					id="{uid}-sex"
					aria-label="Sex"
					class="select"
					bind:value={profile.sex}
					required
					><option value="" disabled>Select sex</option><option>Female</option><option>Male</option
					><option>Other</option><option>Prefer not to say</option></select
				></label
			>
			<label class="user-field profile-wide" for="{uid}-phone"
				><span>Phone number<span aria-hidden="true"> *</span></span><input
					id="{uid}-phone"
					aria-label="Phone number"
					type="tel"
					class="input"
					value={localPhone(profile.phone)}
					oninput={(event) => normalizePhone(event, (value) => (profile.phone = value))}
					autocomplete="tel"
					placeholder="09171234567"
					inputmode="numeric"
					pattern={'09[0-9]{9}'}
					minlength="11"
					maxlength="11"
					required
				/></label
			>
		</div>
	</fieldset>
{/if}
{#if section === 'medical' || section === 'all'}
	<fieldset class="profile-section" disabled={!ready}>
		<legend>Medical information (optional)</legend>
		<p class="user-copy">Optional details that can help a responder understand your needs.</p>
		<label class="user-field" for="{uid}-blood"
			>Blood type<select id="{uid}-blood" class="select" bind:value={profile.bloodType}
				><option value="">Unknown / not provided</option
				>{#each ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as type (type)}<option
						>{type}</option
					>{/each}</select
			></label
		>
		<label class="user-field" for="{uid}-condition"
			>Chronic condition<textarea
				id="{uid}-condition"
				class="textarea"
				bind:value={profile.chronicCondition}
				placeholder="For example, asthma or diabetes"
				maxlength="1000"
				rows="2"></textarea></label
		>
		<label class="user-field" for="{uid}-allergies"
			>Allergies<textarea
				id="{uid}-allergies"
				class="textarea"
				bind:value={profile.allergies}
				placeholder="Include medication or food allergies"
				maxlength="1000"
				rows="2"></textarea></label
		>
		<label class="user-field" for="{uid}-medications"
			>Current medications<textarea
				id="{uid}-medications"
				class="textarea"
				bind:value={profile.currentMedications}
				placeholder="Medication and dosage, if known"
				maxlength="1000"
				rows="2"></textarea></label
		>
		<label class="user-field" for="{uid}-additional"
			>Additional information<textarea
				id="{uid}-additional"
				class="textarea"
				bind:value={profile.additionalInformation}
				placeholder="Anything else a responder should know"
				maxlength="2000"
				rows="3"></textarea></label
		>
	</fieldset>
{/if}
{#if section === 'contacts' || section === 'all'}
	<fieldset class="profile-section" disabled={!ready}>
		<legend>Emergency contacts</legend>
		<p class="user-copy">Choose people you trust to be contacted during an emergency.</p>
		{#each profile.contacts as contact, index (contact.id)}
			<section class="contact-fields" aria-label="Emergency contact {index + 1}">
				<div class="contact-heading">
					<h3>Contact {index + 1}</h3>
					<button
						type="button"
						class="btn btn-ghost btn-sm"
						aria-label="Remove contact {index + 1}"
						onclick={() =>
							(profile.contacts = profile.contacts.filter((person) => person.id !== contact.id))}
						><Trash2 size={17} /></button
					>
				</div>
				<div class="profile-grid">
					<label class="user-field" for="{uid}-{contact.id}-first"
						><span>First name<span aria-hidden="true"> *</span></span><input
							id="{uid}-{contact.id}-first"
							aria-label="First name"
							class="input"
							bind:value={contact.firstName}
							required
							maxlength="60"
						/></label
					>
					<label class="user-field" for="{uid}-{contact.id}-last"
						><span>Last name<span aria-hidden="true"> *</span></span><input
							id="{uid}-{contact.id}-last"
							aria-label="Last name"
							class="input"
							bind:value={contact.lastName}
							required
							maxlength="60"
						/></label
					>
					<label class="user-field profile-wide" for="{uid}-{contact.id}-phone"
						><span>Phone number<span aria-hidden="true"> *</span></span><input
							id="{uid}-{contact.id}-phone"
							aria-label="Phone number"
							class="input"
							type="tel"
							value={localPhone(contact.phone)}
							oninput={(event) => normalizePhone(event, (value) => (contact.phone = value))}
							placeholder="09171234567"
							inputmode="numeric"
							pattern={'09[0-9]{9}'}
							minlength="11"
							maxlength="11"
							required
						/></label
					>
					<label class="user-field profile-wide" for="{uid}-{contact.id}-email"
						><span>Email<span aria-hidden="true"> *</span></span><input
							id="{uid}-{contact.id}-email"
							aria-label="Email"
							class="input"
							type="email"
							bind:value={contact.email}
							maxlength="254"
							required
						/></label
					>
					<div class="profile-wide">
						<RelationshipSelect
							id="{uid}-{contact.id}-relationship"
							bind:value={contact.relationship}
						/>
					</div>
				</div>
			</section>
		{/each}
		<button type="button" class="btn w-full btn-outline" onclick={addContact}
			><Plus size={18} />Add emergency contact</button
		>
	</fieldset>
{/if}

<style>
	.profile-section {
		display: grid;
		gap: 1rem;
		padding: 0;
		border: 0;
		min-width: 0;
		margin: 0 0 1.5rem;
	}
	legend {
		margin-bottom: 1rem;
		font-size: 1rem;
		font-weight: 650;
	}
	.profile-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1rem;
	}
	.profile-wide {
		grid-column: 1 / -1;
	}
	.contact-fields {
		border: 1px solid #45463c;
		border-radius: 1rem;
		padding: 1rem;
	}
	.contact-heading {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1rem;
	}
	h3 {
		margin: 0;
		font-size: 0.9rem;
		font-weight: 600;
	}
	@media (max-width: 360px) {
		.profile-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
