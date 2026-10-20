<script lang="ts">
	import { resolve } from '$app/paths';
	import AuthFrame from '#lib/components/AuthFrame.svelte';
</script>

<svelte:head><title>HandLink | Your safety, connected</title></svelte:head>
<AuthFrame>
	<main id="user-content" class="welcome">
		<section class="welcome-content" aria-labelledby="welcome-title">
			<p class="user-kicker">HANDLINK</p>
			<h1 id="welcome-title">Your safety,<br />connected.</h1>
			<p class="welcome-copy">A helping hand, when you need it most.</p>
			<div class="welcome-actions">
				<a class="btn w-full btn-primary" href={resolve('/login')}>Log In</a>
				<a class="btn w-full btn-outline" href={resolve('/user/register')}>Create Account</a>
			</div>
		</section>
	</main>
</AuthFrame>

<style>
	.welcome {
		min-height: 100dvh;
		display: grid;
		place-items: center;
		padding: 132px 24px 96px;
	}
	.welcome-content {
		width: min(100%, 360px);
		text-align: center;
	}
	h1 {
		font-size: clamp(36px, 7vw, 48px);
		line-height: 1.15;
		font-weight: 400;
		margin-block: 16px;
	}
	.welcome-copy {
		color: var(--app-muted);
		line-height: 1.7;
		margin-block: 20px 36px;
	}
	.welcome-actions {
		display: grid;
		gap: 16px;
	}
</style>
