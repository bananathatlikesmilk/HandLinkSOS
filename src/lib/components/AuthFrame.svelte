<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Pause, Play } from '@lucide/svelte';
	import StaffBrand from './StaffBrand.svelte';
	import ThemeToggle from './ThemeToggle.svelte';
	let { children }: { children: Snippet } = $props();
	let backgroundPaused = $state(false);
</script>

<div
	class="auth-shell handlink-staff"
	class:background-paused={backgroundPaused}
	data-theme="handlink-staff"
>
	<header class="auth-brand"><StaffBrand href="/login" /><ThemeToggle /></header>
	{@render children()}
	<button
		type="button"
		class="background-toggle"
		aria-label={backgroundPaused ? 'Play background animation' : 'Pause background animation'}
		aria-pressed={backgroundPaused}
		onclick={() => (backgroundPaused = !backgroundPaused)}
	>
		{#if backgroundPaused}<Play size={15} />{:else}<Pause size={15} />{/if}
		<span>{backgroundPaused ? 'Play background' : 'Pause background'}</span>
	</button>
</div>

<style>
	.auth-shell {
		position: relative;
		isolation: isolate;
		min-height: 100dvh;
		overflow: hidden;
		background: #000;
		color: #fff;
	}
	.auth-shell::before {
		content: '';
		position: absolute;
		z-index: -2;
		top: 50%;
		left: 50%;
		width: 590px;
		height: 590px;
		transform: translate(-50%, -43%);
		border-radius: 50%;
		background: conic-gradient(
			from 15deg,
			#e32e23 0deg,
			#b62b1d 95deg,
			#bd9724 185deg,
			#d8b341 255deg,
			#e32e23 360deg
		);
		filter: blur(45px);
		opacity: 0.8;
		pointer-events: none;
		animation: aurora-glow 14s ease-in-out infinite alternate;
	}
	.background-paused::before {
		animation-play-state: paused;
	}
	@keyframes aurora-glow {
		from {
			transform: translate(-52%, -43%) rotate(-3deg) skewX(-1.5deg) scale(1.015, 0.995);
		}
		50% {
			transform: translate(-50%, -44%) rotate(0deg) skewX(0deg) scale(1, 1.01);
		}
		to {
			transform: translate(-48%, -43%) rotate(3deg) skewX(1.5deg) scale(0.995, 1.015);
		}
	}
	.background-toggle {
		position: absolute;
		right: 20px;
		bottom: 16px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 7px;
		min-height: 44px;
		padding: 8px 12px;
		border: 1px solid #ffffff40;
		border-radius: 8px;
		background: #0008;
		color: #eee;
		font-size: 12px;
		cursor: pointer;
	}
	.background-toggle:hover {
		background: #ffffff1a;
	}
	.background-toggle:focus-visible {
		outline: 2px solid #fff;
		outline-offset: 4px;
	}
	@media (prefers-reduced-motion: reduce) {
		.auth-shell::before {
			animation: none;
		}
		.background-toggle {
			display: none;
		}
	}
	.auth-shell::after {
		content: '';
		position: absolute;
		z-index: -1;
		inset: 0;
		background: radial-gradient(ellipse 240px 240px at 50% 53%, #000b, transparent 100%);
		pointer-events: none;
	}
	.auth-brand {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		position: absolute;
		top: 32px;
		left: 0;
		right: 0;
		padding-inline: clamp(16px, 4vw, 64px);
	}

	@media (max-width: 520px) {
		.auth-brand {
			top: 28px;
		}
		.auth-shell::before {
			width: 470px;
			height: 550px;
			opacity: 0.65;
		}
	}
</style>
