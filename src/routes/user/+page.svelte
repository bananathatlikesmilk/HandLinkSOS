<script lang="ts">
	import { resolve } from '$app/paths';
	import UserBrand from '#lib/user/UserBrand.svelte';
</script>

<svelte:head><title>HandLink — Your safety, connected</title></svelte:head>
<section class="welcome">
	<div class="welcome-brand">
		<UserBrand large />
		<p class="user-copy">Your safety, connected.</p>
	</div>
	<div class="user-actions welcome-actions">
		<a class="btn w-full btn-primary" href={resolve('/user/login')}>Log In</a>
		<a class="btn w-full btn-outline" href={resolve('/user/register')}>Create Account</a>
		<p class="welcome-note">A helping hand, when you need it most.</p>
	</div>
</section>

<style>
	.welcome {
		min-height: calc(100svh - 10rem);
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		align-items: center;
		padding: clamp(4rem, 14vh, 7rem) 0 2rem;
	}
	.welcome-brand {
		display: grid;
		justify-items: center;
		gap: 1.25rem;
	}
	.welcome-actions {
		width: min(100%, 320px);
		margin-top: 5rem;
	}
	.welcome-note {
		text-align: center;
		font-size: 0.75rem;
		color: #b7b7ab;
		margin-top: 0.75rem;
	}
</style>
