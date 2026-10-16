<script lang="ts">
	import { resolve } from '$app/paths';
	import { Pencil } from '@lucide/svelte';
	import { getUserPreview } from '#lib/user/preview.svelte.ts';
	const preview = getUserPreview();
	const personal = $derived([
		['First name', preview.profile.firstName],
		['Last name', preview.profile.lastName],
		['Birthday', preview.profile.birthday],
		['Sex', preview.profile.sex],
		['Phone number', preview.profile.phone],
		['Email', preview.profile.email]
	]);
	const medical = $derived([
		['Blood type', preview.profile.bloodType],
		['Chronic condition', preview.profile.chronicCondition],
		['Allergies', preview.profile.allergies],
		['Current medications', preview.profile.currentMedications],
		['Additional information', preview.profile.additionalInformation]
	]);
</script>

<svelte:head><title>My information · HandLink</title></svelte:head>
<div class="space-y-6">
	<header>
		<p class="user-kicker">My profile</p>
		<h1 class="user-title">My information</h1>
		<p class="user-copy mt-2">The details registered to {preview.fullName}.</p>
	</header>
	<a class="btn w-full btn-outline" href={resolve('/user/profiles/edit')}
		><Pencil size={18} />Edit information</a
	>
	<section class="user-panel" aria-labelledby="personal-heading">
		<h2 id="personal-heading" class="mb-5 text-lg font-semibold">Personal information</h2>
		<dl class="space-y-4">
			{#each personal as [label, value] (label)}<div>
					<dt class="user-copy text-sm">{label}</dt>
					<dd class="mt-1 break-words">{value || 'Not provided'}</dd>
				</div>{/each}
		</dl>
	</section>
	<section class="user-panel" aria-labelledby="medical-heading">
		<h2 id="medical-heading" class="mb-5 text-lg font-semibold">Medical information</h2>
		<dl class="space-y-4">
			{#each medical as [label, value] (label)}<div>
					<dt class="user-copy text-sm">{label}</dt>
					<dd class="mt-1 break-words whitespace-pre-wrap">{value || 'Not provided'}</dd>
				</div>{/each}
		</dl>
	</section>
	<section class="space-y-4" aria-labelledby="contacts-heading">
		<h2 id="contacts-heading" class="text-lg font-semibold">Emergency contacts</h2>
		{#each preview.profile.contacts as contact (contact.id)}<div class="user-panel">
				<h3 class="mb-4 font-semibold">{contact.firstName} {contact.lastName}</h3>
				<dl class="space-y-3">
					<div>
						<dt class="user-copy text-sm">First name</dt>
						<dd class="break-words">{contact.firstName}</dd>
					</div>
					<div>
						<dt class="user-copy text-sm">Last name</dt>
						<dd class="break-words">{contact.lastName}</dd>
					</div>
					<div>
						<dt class="user-copy text-sm">Phone number</dt>
						<dd class="break-words">{contact.phone}</dd>
					</div>
					<div>
						<dt class="user-copy text-sm">Email</dt>
						<dd class="break-words">{contact.email}</dd>
					</div>
					<div>
						<dt class="user-copy text-sm">Relationship</dt>
						<dd class="break-words">{contact.relationship}</dd>
					</div>
				</dl>
			</div>{:else}<p class="user-copy">
				No emergency contacts recorded. Add one using Edit information.
			</p>{/each}
	</section>
	<a class="btn w-full btn-outline" href={resolve('/user/profiles')}>Back to profiles</a>
</div>
