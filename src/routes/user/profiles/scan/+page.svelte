<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { onDestroy } from 'svelte';
	import { Camera, ImagePlus, ScanLine, UserPlus } from '@lucide/svelte';
	import { BrowserQRCodeReader, type IScannerControls } from '@zxing/browser';
	import { apiRequest } from '#lib/client/request.ts';
	import type { TrustedConnection } from '#lib/trusted.ts';
	import RelationshipSelect from '#lib/user/RelationshipSelect.svelte';
	let video: HTMLVideoElement | undefined;
	let controls: IScannerControls | undefined;
	let generation = 0;
	let alive = true;
	let starting = $state(false);
	let scanning = $state(false);
	let uploading = $state(false);
	let error = $state('');
	let stagedToken = $state('');
	let relationship = $state('');
	let submitting = $state(false);
	let connection = $state<TrustedConnection | null>(null);
	const hasProfile = $derived(Boolean(page.data.accountProfile?.id));
	function attachVideo(element: HTMLVideoElement) {
		video = element;
		return () => {
			if (video === element) {
				stopCamera();
				video = undefined;
			} else stopPreview(element);
		};
	}
	function stopPreview(element: HTMLVideoElement | undefined) {
		const stream = element?.srcObject;
		if (stream && 'getTracks' in stream) for (const track of stream.getTracks()) track.stop();
		if (element) element.srcObject = null;
	}
	function stopCamera() {
		generation += 1;
		controls?.stop();
		controls = undefined;
		stopPreview(video);
		scanning = false;
		starting = false;
	}
	function stage(raw: string) {
		const match = /^handlink:qr:v1:([A-Za-z0-9_-]{43})$/.exec(raw);
		stagedToken = match?.[1] ?? '';
		relationship = '';
		error = match
			? ''
			: 'This is not a valid HandLink invitation. Ask the person for a new QR code.';
	}
	async function startCamera() {
		if (!video || starting || scanning || uploading || submitting || !hasProfile) return;
		stopCamera();
		const request = generation;
		starting = true;
		error = '';
		stagedToken = '';
		try {
			const nextControls = await new BrowserQRCodeReader().decodeFromVideoDevice(
				undefined,
				video,
				(result, _reason, activeControls) => {
					if (!alive || request !== generation) {
						activeControls.stop();
						return;
					}
					if (result) {
						activeControls.stop();
						stopCamera();
						stage(result.getText());
					}
				}
			);
			if (!alive || request !== generation) {
				nextControls.stop();
				return;
			}
			controls = nextControls;
			starting = false;
			scanning = true;
		} catch {
			if (!alive || request !== generation) return;
			stopCamera();
			error =
				'Camera unavailable or permission denied. Allow camera access, or upload a QR image instead.';
		}
	}
	async function readImage(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file || uploading || submitting || !hasProfile) return;
		stopCamera();
		stagedToken = '';
		error = '';
		if (!file.type.startsWith('image/') || file.size > 10 * 1024 * 1024) {
			error = 'Choose a QR image smaller than 10 MB.';
			return;
		}
		const request = generation;
		const url = URL.createObjectURL(file);
		uploading = true;
		try {
			const result = await new BrowserQRCodeReader().decodeFromImageUrl(url);
			if (alive && request === generation) stage(result.getText());
		} catch {
			if (alive && request === generation)
				error = 'No readable QR code found. Choose a clear image of a HandLink invitation.';
		} finally {
			URL.revokeObjectURL(url);
			if (alive) uploading = false;
		}
	}
	async function requestAccess(event: SubmitEvent) {
		event.preventDefault();
		if (submitting || !stagedToken || !hasProfile) return;
		submitting = true;
		error = '';
		try {
			const result = await apiRequest<{ connection: TrustedConnection }>('/api/trusted/scan', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ token: stagedToken, relationship: relationship.trim() })
			});
			if (alive) {
				connection = result.connection;
				stagedToken = '';
				relationship = '';
			}
		} catch (reason) {
			if (alive)
				error = reason instanceof Error ? reason.message : 'Unable to request trusted access.';
		} finally {
			if (alive) submitting = false;
		}
	}
	onDestroy(() => {
		alive = false;
		stopCamera();
	});
</script>

<svelte:document
	onvisibilitychange={() => {
		if (typeof document !== 'undefined' && document.hidden) stopCamera();
	}}
/>

<svelte:head><title>Scan QR · HandLink</title></svelte:head>
<div class="space-y-6">
	<header>
		<p class="user-kicker">Add profiles</p>
		<h1 class="user-title">Scan QR</h1>
		<p class="user-copy mt-2">Scan the verified code of someone you trust.</p>
	</header>
	<p class="user-notice">
		Scanning sends a request. Their approval is required before you can send SOS for them.
	</p>
	{#if !hasProfile}
		<section class="user-panel space-y-4">
			<h2 class="text-lg font-semibold">Save your profile first</h2>
			<p class="user-copy">Complete your personal information before requesting trusted access.</p>
			<a class="btn w-full btn-primary" href={resolve('/user/profiles/edit')}>Edit my profile</a>
		</section>
	{:else if connection}
		<section class="user-panel space-y-4" role="status">
			<UserPlus size={28} />
			<h2 class="text-lg font-semibold">Request sent to {connection.ownerName}</h2>
			<p class="user-copy">Waiting for approval. Check the request in Profiles.</p>
		</section>
	{:else}
		<section class="user-panel space-y-5" aria-labelledby="scanner-heading">
			<h2 id="scanner-heading" class="sr-only">QR scanner</h2>
			<div class="camera-frame">
				<video
					{@attach attachVideo}
					autoplay
					muted
					playsinline
					aria-label="QR scanner camera preview"
				></video>{#if !starting && !scanning}<div class="camera-placeholder">
						<ScanLine size={64} strokeWidth={1.2} /><span
							>Camera starts when you choose Start camera.</span
						>
					</div>{/if}
			</div>
			<p class="user-copy text-center" role="status">
				{uploading
					? 'Reading QR image…'
					: starting
						? 'Waiting for camera access…'
						: scanning
							? 'Hold the QR code inside the camera view.'
							: 'Camera is off.'}
			</p>
			{#if scanning || starting}<button class="btn w-full btn-outline" onclick={stopCamera}
					>Stop camera</button
				>{:else}<button
					class="btn w-full btn-primary"
					disabled={uploading || submitting}
					onclick={startCamera}><Camera size={18} />Start camera</button
				>{/if}<label class="upload-label"
				><ImagePlus size={18} />Upload a QR image<input
					class="file-input w-full"
					type="file"
					accept="image/*"
					disabled={uploading || starting || scanning || submitting}
					onchange={readImage}
				/><span class="user-copy text-sm">PNG, JPG, or SVG. Maximum 10 MB.</span></label
			>
		</section>
		{#if stagedToken}<section class="user-panel space-y-4" aria-labelledby="found-heading">
				<UserPlus size={28} />
				<h2 id="found-heading" class="text-lg font-semibold">Invitation found</h2>
				<p class="user-copy">
					Continue only with someone you trust. They will see your name and relationship.
				</p>
				<form class="space-y-4" onsubmit={requestAccess}>
					<RelationshipSelect
						label="Your relationship to this person"
						bind:value={relationship}
						disabled={submitting}
					/>
					<div class="user-actions">
						<button
							type="button"
							class="btn btn-outline"
							disabled={submitting}
							onclick={() => (stagedToken = '')}>Cancel</button
						><button class="btn btn-primary" type="submit" disabled={submitting}
							>{submitting ? 'Sending request…' : 'Request trusted access'}</button
						>
					</div>
				</form>
			</section>{/if}
	{/if}
	{#if error}<p class="user-error" role="alert">{error}</p>{/if}
	<a class="btn w-full btn-ghost" href={resolve('/user/profiles')}>Back to profiles</a>
</div>

<style>
	.camera-frame {
		position: relative;
		aspect-ratio: 1;
		overflow: hidden;
		border: 1px solid #a6a18b;
		border-radius: 18px;
		background: #10110b;
	}
	.camera-frame video {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.camera-placeholder {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 1.2rem;
		padding: 2rem;
		color: #d4ceae;
		text-align: center;
	}
	.camera-placeholder span {
		font-size: 0.875rem;
		line-height: 1.6;
	}
	.upload-label {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.6rem;
	}
</style>
