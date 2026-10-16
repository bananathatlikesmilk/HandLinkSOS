<script lang="ts">
	import { LockKeyhole } from '@lucide/svelte';
	import { resolve } from '$app/paths';
	let {
		large = false,
		href = '/dispatch/login'
	}: { large?: boolean; href?: '/dispatch/login' | '/admin/login' | '/dispatch' | '/admin' } =
		$props();
</script>

<a class="staff-brand" class:large href={resolve(href)} aria-label="HandLink home">
	<span class="emblem" aria-hidden="true"><span></span><span></span><span></span></span>
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
		position: relative;
		width: 25px;
		height: 33px;
		margin-right: 4px;
	}
	.emblem span {
		position: absolute;
		left: 4px;
		width: 17px;
		height: 17px;
		transform: rotate(45deg);
		border: 1px dotted #d7ccc6;
	}
	.emblem span:nth-child(1) {
		top: 1px;
		background: #777772;
	}
	.emblem span:nth-child(2) {
		top: 8px;
		background: #f28a73;
	}
	.emblem span:nth-child(3) {
		top: 15px;
		background: #c6382b;
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
	.large .emblem span {
		width: 54px;
		height: 54px;
		left: calc(50% - 27px);
	}
	.large .emblem span:nth-child(1) {
		top: 0;
	}
	.large .emblem span:nth-child(2) {
		top: 22px;
	}
	.large .emblem span:nth-child(3) {
		top: 44px;
	}
</style>
