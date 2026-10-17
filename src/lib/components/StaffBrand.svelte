<script lang="ts">
	import { LockKeyhole } from '@lucide/svelte';
	import { asset, resolve } from '$app/paths';
	let {
		large = false,
		href = '/dispatch/login'
	}: { large?: boolean; href?: '/dispatch/login' | '/admin/login' | '/dispatch' | '/admin' } =
		$props();
</script>

<a class="staff-brand" class:large href={resolve(href)} aria-label="HandLink home">
	<img class="emblem" src={asset('logo.png')} alt="" width="3543" height="3543" />
	<span>HandLink</span><LockKeyhole size={large ? 27 : 22} strokeWidth={1.1} aria-hidden="true" />
</a>

<style>
	.staff-brand {
		display: inline-flex;
		align-items: center;
		gap: 9px;
		color: #eeeeec;
		font-size: 26px;
		font-weight: 300;
		letter-spacing: 1px;
		text-decoration: none;
	}
	.emblem {
		display: block;
		width: 25px;
		height: 33px;
		flex-shrink: 0;
		margin-right: 4px;
		object-fit: contain;
		mix-blend-mode: screen;
	}
	.large {
		font-size: 34px;
		flex-wrap: wrap;
		justify-content: center;
	}
	.large .emblem {
		flex-basis: 100%;
		height: 100px;
		margin: 0 0 16px;
	}
</style>
