<script lang="ts">
	import { LockKeyhole } from '@lucide/svelte';
	import { resolve } from '$app/paths';
	let { large = false }: { large?: boolean } = $props();
</script>

<a class="user-brand" class:large href={resolve('/user')} aria-label="HandLink User home"
	><span class="user-emblem" aria-hidden="true"><span></span><span></span><span></span></span><span
		>HandLink</span
	><LockKeyhole size={large ? 27 : 18} strokeWidth={1.1} aria-hidden="true" /></a
>

<style>
	.user-brand {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		color: #e4e3dc;
		font-size: 19px;
		letter-spacing: 1px;
		font-weight: 300;
		text-decoration: none;
	}
	.user-emblem {
		display: inline-block;
		width: 17px;
		height: 22px;
		position: relative;
		margin-right: 3px;
	}
	.user-emblem > span {
		position: absolute;
		width: 11px;
		height: 11px;
		transform: rotate(45deg);
		left: 3px;
		border: 1px dotted #f5c8bf;
	}
	.user-emblem > span:nth-child(1) {
		top: 1px;
		background: #8b8b80;
	}
	.user-emblem > span:nth-child(2) {
		top: 5px;
		background: #e98874;
	}
	.user-emblem > span:nth-child(3) {
		top: 9px;
		background: #cf3228;
	}
	.large {
		flex-wrap: wrap;
		justify-content: center;
		font-size: 36px;
		gap: 10px;
	}
	.large .user-emblem {
		flex-basis: 100%;
		height: 108px;
		width: 100%;
		margin: 0 0 17px;
	}
	.large .user-emblem > span {
		width: 62px;
		height: 62px;
		left: calc(50% - 31px);
		border-width: 2px;
		background: repeating-linear-gradient(45deg, transparent 0 2px, #fff6 2px 3px);
	}
	.large .user-emblem > span:nth-child(1) {
		top: 0;
		border-color: #d8d8ca;
		background-color: #747268;
	}
	.large .user-emblem > span:nth-child(2) {
		top: 22px;
		border-color: #f9d3c8;
		background-color: #f67b61;
	}
	.large .user-emblem > span:nth-child(3) {
		top: 42px;
		border-color: #dc3227;
		background-color: #b93024;
		box-shadow: 0 0 35px #f2482940;
	}
</style>
