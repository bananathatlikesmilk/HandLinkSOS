<script lang="ts">
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import { ChevronRight, Pencil, QrCode, ScanLine, Trash2, UserRound, Users } from '@lucide/svelte';
	import { getUserPreview } from '#lib/user/preview.svelte.ts';
	import { apiRequest } from '#lib/client/request.ts';
	import type { TrustedConnection } from '#lib/trusted.ts';
	import RelationshipSelect from '#lib/user/RelationshipSelect.svelte';
	const preview = getUserPreview();
	let revealed = $state('');
	let removing = $state<TrustedConnection | null>(null);
	let notice = $state('');
	let error = $state('');
	let connections = $state<TrustedConnection[]>([]);
	let currentProfileId = $state('');
	let loading = $state(true);
	let busy = $state(false);
	let mutualRequests = $state<Record<string, boolean>>({});
	let mutualRelationships = $state<Record<string, string>>({});
	let refreshing = false;
	let currentRefresh: Promise<void> | null = null;
	let stopped = false;
	const incoming = $derived(
		connections.filter(
			(item) => item.status === 'pending' && item.ownerProfileId === currentProfileId
		)
	);
	const outgoing = $derived(
		connections.filter(
			(item) => item.status === 'pending' && item.requesterProfileId === currentProfileId
		)
	);
	const trusted = $derived(
		connections.filter(
			(item) => item.status === 'approved' && item.requesterProfileId === currentProfileId
		)
	);
	const allowed = $derived(
		connections.filter(
			(item) => item.status === 'approved' && item.ownerProfileId === currentProfileId
		)
	);
	function otherName(connection: TrustedConnection) {
		return connection.ownerProfileId === currentProfileId
			? connection.requesterName
			: connection.ownerName;
	}
	function refresh(): Promise<void> {
		if (currentRefresh) return currentRefresh;
		currentRefresh = loadConnections().finally(() => {
			currentRefresh = null;
		});
		return currentRefresh;
	}
	async function loadConnections() {
		if (refreshing || stopped) return;
		refreshing = true;
		try {
			const result = await apiRequest<{
				connections: TrustedConnection[];
				currentProfileId: string;
			}>('/api/trusted');
			if (stopped) return;
			connections = result.connections;
			currentProfileId = result.currentProfileId;
			error = '';
		} catch (cause) {
			if (!stopped)
				error = cause instanceof Error ? cause.message : 'Could not load trusted profiles.';
		} finally {
			refreshing = false;
			if (!stopped) loading = false;
		}
	}
	async function changeConnection(connection: TrustedConnection, action: 'approve' | 'revoke') {
		if (busy) return;
		const requestMutual = action === 'approve' && Boolean(mutualRequests[connection.id]);
		const mutualRelationship = (mutualRelationships[connection.id] ?? '').trim();
		if (requestMutual && (!mutualRelationship || mutualRelationship.length > 100)) {
			error = 'Enter your relationship to this person using 1 to 100 characters.';
			return;
		}
		busy = true;
		error = '';
		notice = '';
		try {
			await currentRefresh;
			const result = await apiRequest<{
				connection: TrustedConnection;
				mutualRequest: TrustedConnection | null;
			}>(`/api/trusted/${encodeURIComponent(connection.id)}`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(
					action === 'approve'
						? {
								action,
								invitationId: connection.invitationId,
								...(requestMutual ? { requestMutual: true, mutualRelationship } : {})
							}
						: { action }
				)
			});
			removing = null;
			revealed = '';
			notice =
				action === 'approve'
					? `${connection.requesterName} can now send SOS for you.`
					: `Connection with ${otherName(connection)} removed.`;
			if (requestMutual) {
				notice +=
					result.mutualRequest?.status === 'approved'
						? ` You already have permission to send SOS for ${connection.requesterName}.`
						: result.mutualRequest?.status === 'pending'
							? ` Your request is pending. ${connection.requesterName} must approve before you can send SOS for them.`
							: ' Reverse permission was not granted. Scan a new QR code to request access again.';
			}
			delete mutualRequests[connection.id];
			delete mutualRelationships[connection.id];
			await refresh();
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Could not update trusted profile.';
		} finally {
			busy = false;
		}
	}
	onMount(() => {
		void refresh();
		const refreshVisible = () => {
			if (document.visibilityState === 'visible' && !busy) void refresh();
		};
		const interval = setInterval(refreshVisible, 5000);
		document.addEventListener('visibilitychange', refreshVisible);
		return () => {
			stopped = true;
			clearInterval(interval);
			document.removeEventListener('visibilitychange', refreshVisible);
		};
	});
	const initials = $derived(
		preview.fullName
			.split(/\s+/)
			.slice(0, 2)
			.map((part) => part[0] ?? '')
			.join('')
	);
	function swipe(id: string) {
		return (element: HTMLElement) => {
			let startX = 0;
			let startY = 0;
			const start = (event: PointerEvent) => {
				startX = event.clientX;
				startY = event.clientY;
			};
			const end = (event: PointerEvent) => {
				const horizontal = event.clientX - startX;
				if (Math.abs(horizontal) > 45 && Math.abs(horizontal) > Math.abs(event.clientY - startY))
					revealed = horizontal < 0 ? id : '';
			};
			element.addEventListener('pointerdown', start);
			element.addEventListener('pointerup', end);
			return () => {
				element.removeEventListener('pointerdown', start);
				element.removeEventListener('pointerup', end);
			};
		};
	}
</script>

<svelte:head><title>Profiles · HandLink</title></svelte:head>
<div class="space-y-7">
	<header>
		<p class="user-kicker">Your safety circle</p>
		<h1 class="user-title">Profiles</h1>
		<p class="user-copy mt-2">Your information and the people you trust.</p>
	</header>
	{#if notice}<p class="user-notice" role="status">{notice}</p>{/if}
	{#if error}<p class="user-notice" role="alert">{error}</p>
		<button class="btn btn-outline" onclick={() => refresh()} disabled={loading || busy}
			>Retry loading profiles</button
		>{/if}
	<section class="user-panel space-y-5" aria-labelledby="my-profile-heading">
		<div class="flex items-center justify-between gap-3">
			<h2 id="my-profile-heading" class="text-lg font-semibold">My profile</h2>
			<a class="btn btn-ghost" href={resolve('/user/profiles/edit')}><Pencil size={17} /> Edit</a>
		</div>
		<a
			class="own-profile"
			href={resolve('/user/profiles/details')}
			aria-label={`View ${preview.fullName}'s profile details`}
			><span class="profile-avatar">{initials || 'ME'}</span><span class="min-w-0 flex-1"
				><strong class="block break-words">{preview.fullName || 'Your profile'}</strong><span
					class="user-copy block text-sm">Personal and medical information</span
				></span
			><ChevronRight size={22} /></a
		>
	</section>
	<section class="user-panel space-y-4" aria-labelledby="add-profiles-heading">
		<h2 id="add-profiles-heading" class="text-lg font-semibold">Add profiles</h2>
		<p class="user-copy">Share your QR code or scan a trusted person's code.</p>
		<div class="grid grid-cols-2 gap-3">
			<a class="qr-action" href={resolve('/user/profiles/qr')}
				><QrCode size={30} strokeWidth={1.4} /><span>My QR code</span></a
			><a class="qr-action" href={resolve('/user/profiles/scan')}
				><ScanLine size={30} strokeWidth={1.4} /><span>Scan QR code</span></a
			>
		</div>
		<p class="user-copy text-sm">
			Email verification unlocks your QR code. Scanning requests access; you must approve before
			another person can send SOS for you.
		</p>
	</section>
	<section class="space-y-4" aria-labelledby="pending-requests-heading">
		<h2 id="pending-requests-heading" class="text-lg font-semibold">Pending requests</h2>
		{#if loading}<p class="user-copy" role="status">Loading trusted profiles…</p>{/if}
		{#each incoming as connection (connection.id)}
			<article class="user-panel space-y-3" aria-label={`Request from ${connection.requesterName}`}>
				<h3 class="font-semibold">{connection.requesterName}</h3>
				<p class="user-copy">{connection.relationship}. Wants permission to send SOS for you.</p>
				<form
					class="space-y-3"
					onsubmit={(event) => {
						event.preventDefault();
						void changeConnection(connection, 'approve');
					}}
				>
					<label class="flex items-start gap-3">
						<input
							type="checkbox"
							class="checkbox mt-1"
							bind:checked={mutualRequests[connection.id]}
							disabled={busy}
						/>
						<span>Also request permission to send SOS for them</span>
					</label>
					{#if mutualRequests[connection.id]}
						<RelationshipSelect
							label="Your relationship to this person"
							bind:value={
								() => mutualRelationships[connection.id] ?? '',
								(value) => (mutualRelationships[connection.id] = value)
							}
							disabled={busy}
						/>
						<p class="user-copy text-sm">
							They must approve your separate request. Approving theirs only lets them send SOS for
							you.
						</p>
					{/if}
					<div class="user-actions">
						<button type="submit" class="btn btn-primary" disabled={busy}>Approve</button><button
							type="button"
							class="btn btn-outline"
							disabled={busy}
							onclick={() => changeConnection(connection, 'revoke')}>Decline</button
						>
					</div>
				</form>
			</article>
		{/each}
		{#each outgoing as connection (connection.id)}
			<article class="user-panel space-y-3" aria-label={`Request to ${connection.ownerName}`}>
				<h3 class="font-semibold">{connection.ownerName}</h3>
				<p class="user-copy">Waiting for approval. You cannot send SOS for this person yet.</p>
				<button
					class="btn btn-outline"
					disabled={busy}
					onclick={() => changeConnection(connection, 'revoke')}>Cancel request</button
				>
			</article>
		{/each}
		{#if !loading && !error && !incoming.length && !outgoing.length}<p class="user-copy">
				No pending requests.
			</p>{/if}
	</section>
	<section class="space-y-4" aria-labelledby="trusted-profiles-heading">
		<div class="flex items-center gap-2">
			<Users size={20} />
			<h2 id="trusted-profiles-heading" class="text-lg font-semibold">
				People you can send SOS for
			</h2>
			<span class="user-copy ml-auto text-sm">{trusted.length}</span>
		</div>
		<p class="user-copy text-sm">Swipe left to reveal removal, or use the Remove button.</p>
		{#each trusted as person (person.id)}<div class="trusted-wrap">
				<button
					class="swipe-remove"
					tabindex={revealed === person.id ? 0 : -1}
					aria-hidden={revealed !== person.id}
					aria-label={`Remove ${person.ownerName}`}
					disabled={busy}
					onclick={() => (removing = person)}><Trash2 size={20} /></button
				>
				<div class="trusted-row" class:revealed={revealed === person.id} {@attach swipe(person.id)}>
					<span class="profile-avatar small"><UserRound size={21} /></span><strong
						class="min-w-0 flex-1 break-words">{person.ownerName}</strong
					><button
						class="btn btn-ghost"
						aria-label={`Remove ${person.ownerName} from trusted profiles`}
						disabled={busy}
						onclick={() => (removing = person)}
						><Trash2 size={17} /><span class="text-sm">Remove</span></button
					>
				</div>
			</div>{:else}<div class="user-panel py-8 text-center">
				<Users class="mx-auto mb-3" size={28} />
				<p>{loading ? 'Loading profiles…' : 'No approved profiles yet.'}</p>
				<p class="user-copy mt-2">Scan a person's HandLink QR code to add them.</p>
			</div>{/each}
	</section>
	<section class="space-y-4" aria-labelledby="allowed-profiles-heading">
		<h2 id="allowed-profiles-heading" class="text-lg font-semibold">
			People allowed to send SOS for you
		</h2>
		{#each allowed as connection (connection.id)}
			<article class="user-panel flex flex-wrap items-center justify-between gap-3">
				<div>
					<h3 class="font-semibold">{connection.requesterName}</h3>
					<p class="user-copy text-sm">{connection.relationship}</p>
				</div>
				<button
					class="btn btn-outline"
					disabled={busy}
					aria-label={`Revoke ${connection.requesterName}'s access`}
					onclick={() => (removing = connection)}>Revoke access</button
				>
			</article>
		{:else}<p class="user-copy">
				{loading ? 'Loading access…' : 'Nobody has permission yet.'}
			</p>{/each}
	</section>
	{#if removing}<section class="user-panel space-y-4" aria-label="Confirm profile removal">
			<h2 class="text-lg font-semibold">Remove {otherName(removing)}?</h2>
			<p class="user-copy">
				{removing.ownerProfileId === currentProfileId
					? 'This person will no longer be able to send SOS for you.'
					: 'You will no longer be able to send SOS for this person.'} Existing incident records are retained.
			</p>
			<div class="user-actions">
				<button class="btn btn-outline" disabled={busy} onclick={() => (removing = null)}
					>Keep profile</button
				><button
					class="btn btn-error"
					disabled={busy}
					onclick={() => removing && changeConnection(removing, 'revoke')}>Remove profile</button
				>
			</div>
		</section>{/if}
</div>

<style>
	.own-profile {
		display: flex;
		align-items: center;
		gap: 1rem;
		min-height: 76px;
	}
	.profile-avatar {
		display: grid;
		place-items: center;
		flex-shrink: 0;
		width: 60px;
		height: 60px;
		border: 1px solid #b2af9c;
		border-radius: 50%;
		color: #e8e4d2;
		font-size: 1.15rem;
	}
	.profile-avatar.small {
		width: 44px;
		height: 44px;
	}
	.qr-action {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.8rem;
		padding: 1.25rem 0.5rem;
		min-height: 110px;
		border: 1px solid #817f70;
		border-radius: 12px;
		text-align: center;
	}
	.qr-action:hover {
		background: #29291d;
	}
	.trusted-wrap {
		position: relative;
		overflow: hidden;
		border: 1px solid #777769;
		border-radius: 12px;
	}
	.trusted-row {
		position: relative;
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.9rem 0.75rem;
		background: #17180f;
		touch-action: pan-y;
		transition: transform 160ms ease;
	}
	.trusted-row.revealed {
		transform: translateX(-64px);
	}
	.swipe-remove {
		position: absolute;
		right: 0;
		inset-block: 0;
		width: 64px;
		display: grid;
		place-items: center;
		background: #773b30;
		color: #fff;
	}
	@media (prefers-reduced-motion: reduce) {
		.trusted-row {
			transition: none;
		}
	}
</style>
