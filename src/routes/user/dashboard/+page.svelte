<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { ArrowRight, Plus, Search, Siren, Star, Users } from '@lucide/svelte';
	import { getUserPreview } from '#lib/user/preview.svelte.ts';
	import { incidentRequest, type SosTarget } from '#lib/user/incidents-client.ts';
	import type { IncidentSummary } from '#lib/incidents.ts';
	const preview = getUserPreview();
	let targets = $state<SosTarget[]>([]);
	let incidents = $state<IncidentSummary[]>([]);
	let loading = $state(true);
	let error = $state('');
	const self = $derived(targets.find((target) => target.id === preview.profile.id));
	const trusted = $derived(targets.filter((target) => target.id !== preview.profile.id));
	let search = $state('');
	let savingFavorites = $state<string[]>([]);
	let favoriteError = $state('');
	let targetRevision = 0;
	const visiblePeople = $derived(
		trusted
			.filter((person) =>
				person.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
			)
			.sort(
				(a, b) =>
					Number(b.favorite) - Number(a.favorite) ||
					a.name.localeCompare(b.name) ||
					a.id.localeCompare(b.id)
			)
	);
	let controller: AbortController;
	let refreshing = false;
	async function refresh() {
		if (refreshing) return;
		refreshing = true;
		const revision = targetRevision;
		try {
			const [people, alerts] = await Promise.all([
				incidentRequest<{ targets: SosTarget[] }>('/api/incidents/targets', {
					signal: controller.signal
				}),
				incidentRequest<{ incidents: IncidentSummary[] }>('/api/incidents', {
					signal: controller.signal
				})
			]);
			if (revision === targetRevision && !savingFavorites.length) targets = people.targets;
			incidents = alerts.incidents;
			error = '';
		} catch (cause) {
			if (!controller.signal.aborted)
				error = cause instanceof Error ? cause.message : 'Could not load SOS alerts.';
		} finally {
			loading = false;
			refreshing = false;
		}
	}
	onMount(() => {
		controller = new AbortController();
		void refresh();
		const interval = setInterval(() => {
			if (!document.hidden) void refresh();
		}, 5000);
		return () => {
			controller.abort();
			clearInterval(interval);
		};
	});
	async function start(id: string) {
		await goto(resolve(`/user/sos?profile=${encodeURIComponent(id)}`));
	}
	async function toggleFavorite(person: SosTarget) {
		if (savingFavorites.includes(person.id)) return;
		favoriteError = '';
		savingFavorites = [...savingFavorites, person.id];
		targetRevision++;
		try {
			const saved = await incidentRequest<{ id: string; favorite: boolean }>(
				resolve('/api/incidents/targets/[id]/favorite', { id: person.id }),
				{
					method: 'PUT',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ favorite: !person.favorite }),
					signal: controller.signal
				}
			);
			targets = targets.map((target) =>
				target.id === saved.id ? { ...target, favorite: saved.favorite } : target
			);
		} catch (cause) {
			if (!controller.signal.aborted)
				favoriteError = cause instanceof Error ? cause.message : 'Could not save favorite.';
		} finally {
			targetRevision++;
			savingFavorites = savingFavorites.filter((id) => id !== person.id);
		}
	}
</script>

<svelte:head><title>My SOS dashboard · HandLink</title></svelte:head>
<div class="dashboard-screen">
	<div class="dashboard-intro">
		<p class="user-kicker">YOUR PERSONAL SAFETY SPACE</p>
		<h1 class="user-title mt-3">Your safety dashboard</h1>
		<p class="user-copy mt-3">For you. For the people you trust.</p>
	</div>
	{#if !preview.accountActive}<div class="user-error" role="status">
			This account is deactivated.
		</div>{/if}
	{#if error}<p class="user-error" role="alert">{error}</p>
		<button class="btn btn-outline" onclick={refresh}>Retry loading</button>{/if}
	{#if !loading && !self}<p class="user-copy mt-4">
			Complete and save your profile before sending SOS.
		</p>{/if}
	<div class="self-area">
		<button
			class="self-sos"
			disabled={loading || !self}
			onclick={() => self && start(self.id)}
			aria-label={`Start SOS for ${preview.fullName}`}
			><Siren size={31} strokeWidth={1.2} /><span>{preview.fullName}</span><small>SOS FOR ME</small
			></button
		>
		<p class="user-copy mt-5 text-center">
			SOS includes your location. Cancel within five seconds.
		</p>
	</div>
	<section class="trusted-section" aria-labelledby="trusted-title">
		<div class="flex items-center justify-between gap-3">
			<h2 id="trusted-title">Added profiles</h2>
			<a href={resolve('/user/profiles')}><Plus size={14} /> Add profile</a>
		</div>
		<label class="recipient-search">
			<Search size={18} aria-hidden="true" />
			<input
				class="input"
				type="search"
				aria-label="Search SOS profiles"
				placeholder="Search by name"
				bind:value={search}
			/>
		</label>
		{#if favoriteError}<p class="user-error" role="alert">{favoriteError}</p>{/if}
		<div class="trusted-buttons">
			{#each visiblePeople as person (person.id)}
				<div class="trusted-person" class:favorite={person.favorite}>
					<button
						class="trusted-sos"
						disabled={loading}
						aria-label={`Start SOS for ${person.name}`}
						onclick={() => start(person.id)}
						><span>{person.name}</span><Siren size={17} strokeWidth={1.4} /></button
					>
					<button
						class="favorite-toggle"
						class:selected={person.favorite}
						type="button"
						aria-label={`${person.favorite ? 'Remove' : 'Add'} ${person.name} ${person.favorite ? 'from' : 'to'} favorites`}
						aria-pressed={person.favorite}
						disabled={savingFavorites.includes(person.id)}
						onclick={() => toggleFavorite(person)}
					>
						<Star size={21} fill={person.favorite ? 'currentColor' : 'none'} aria-hidden="true" />
					</button>
				</div>
			{:else}<p class="user-copy">
					{search.trim() ? 'No matching profiles.' : 'No approved trusted profiles available.'}
				</p>{/each}
		</div>
		<p class="trusted-help">Send SOS for approved profiles. Star favorites to keep them on top.</p>
	</section>
	<section class="user-panel mt-6 space-y-3" aria-labelledby="recent-sos-title">
		<h2 id="recent-sos-title">Your recent SOS alerts</h2>
		{#each incidents.slice(0, 5) as incident (incident.id)}
			<article class="border-t border-white/15 pt-3">
				<strong>{incident.personName}</strong>
				<p class="user-copy">{incident.status}</p>
				<p class="user-copy break-all">Incident reference: {incident.reference}</p>
				<p class="user-copy">{new Date(incident.startedAt).toLocaleString()}</p>
			</article>
		{:else}<p class="user-copy">
				{loading ? 'Loading alerts...' : 'No SOS alerts sent yet.'}
			</p>{/each}
	</section>
	<div class="dashboard-actions">
		<a class="share-link btn btn-outline" href={resolve('/user/sharing')}
			>Share location <ArrowRight size={17} /></a
		><a class="btn btn-ghost" href={resolve('/user/profiles')}><Users size={17} /> My profiles</a>
	</div>
	<p class="emergency-note">
		For a real emergency, contact your local emergency services directly.
	</p>
</div>

<style>
	.dashboard-screen {
		display: flex;
		flex-direction: column;
		min-height: 680px;
	}
	.dashboard-intro {
		text-align: center;
		margin-top: 17px;
	}
	.self-area {
		padding: 40px 0 25px;
	}
	.self-sos {
		width: 213px;
		height: 213px;
		border: 2px solid var(--app-border);
		border-radius: 50%;
		background: transparent;
		display: flex;
		flex-direction: column;
		gap: 17px;
		align-items: center;
		justify-content: center;
		margin: auto;
		color: var(--app-text);
		transition:
			border-color 150ms,
			background 150ms;
	}
	.self-sos:hover:not(:disabled) {
		border-color: var(--app-accent);
		background: var(--app-surface-alt);
	}
	.self-sos span {
		font-size: 18px;
		letter-spacing: 2px;
		font-weight: 300;
	}
	.self-sos small {
		color: var(--app-muted);
		font-size: 11px;
		letter-spacing: 2px;
	}
	.trusted-section {
		margin-top: 15px;
	}
	.trusted-section h2 {
		font-size: 16px;
		font-weight: 500;
	}
	.trusted-section a {
		color: var(--app-accent);
		font-size: 12px;
		display: flex;
		align-items: center;
		gap: 4px;
		min-height: 44px;
	}
	.trusted-buttons {
		display: grid;
		gap: 11px;
		margin-top: 12px;
	}
	.trusted-sos {
		flex: 1;
		min-width: 0;
		border: 1px solid var(--app-border);
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 13px 18px;
		min-height: 52px;
		font-size: 14px;
		letter-spacing: 1.3px;
		background: transparent;
		color: var(--app-text);
	}
	.trusted-sos:hover {
		background: var(--app-surface-alt);
	}
	.recipient-search {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-top: 12px;
		color: var(--app-muted);
	}
	.recipient-search input {
		width: 100%;
		min-width: 0;
	}
	.recipient-search input::placeholder {
		color: var(--app-muted);
		opacity: 1;
	}
	.trusted-person {
		display: flex;
		gap: 8px;
	}
	.trusted-person.favorite .trusted-sos {
		border-color: var(--app-accent);
	}
	.trusted-sos span {
		overflow-wrap: anywhere;
	}
	.favorite-toggle {
		display: grid;
		place-items: center;
		width: 52px;
		min-height: 52px;
		flex-shrink: 0;
		border: 1px solid var(--app-border);
		background: var(--app-surface);
		color: var(--app-muted);
		border-radius: 8px;
	}
	.favorite-toggle.selected {
		color: var(--app-accent);
		border-color: var(--app-accent);
	}
	.favorite-toggle:focus-visible {
		outline: 2px solid var(--app-accent);
		outline-offset: 3px;
	}
	.trusted-help {
		font-size: 12px;
		line-height: 1.6;
		color: var(--app-muted);
		margin-top: 12px;
	}
	.dashboard-actions {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 12px;
		margin-top: 35px;
	}
	.dashboard-actions .share-link {
		color: var(--app-accent);
		border-color: var(--app-border);
	}
	.emergency-note {
		font-size: 12px;
		color: var(--app-muted);
		line-height: 1.7;
		text-align: center;
		margin-top: 25px;
	}
	@media (max-width: 360px) {
		.dashboard-actions {
			grid-template-columns: 1fr;
		}
		.self-sos {
			width: 190px;
			height: 190px;
		}
	}
</style>
