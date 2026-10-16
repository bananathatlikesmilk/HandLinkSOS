<script lang="ts">
	import { MapPin, Navigation, LocateFixed } from '@lucide/svelte';
	let {
		location = 'Quezon City, Metro Manila',
		compact = false
	}: { location?: string; compact?: boolean } = $props();
</script>

<div class="map-preview" class:compact>
	<svg
		viewBox="0 0 600 300"
		preserveAspectRatio="xMidYMid slice"
		aria-hidden="true"
		class="street-map"
	>
		<rect width="600" height="300" fill="#eaf0eb" />
		<path d="M380 0 L410 80 390 150 440 210 420 300H600V0Z" fill="#d6e7e3" />
		<g fill="#dce7d9"
			><rect x="15" y="20" width="130" height="65" rx="8" /><rect
				x="170"
				y="125"
				width="100"
				height="80"
				rx="8"
			/><rect x="280" y="20" width="85" height="75" rx="8" /><rect
				x="38"
				y="215"
				width="95"
				height="65"
				rx="8"
			/><rect x="455" y="135" width="115" height="62" rx="8" /></g
		>
		<g stroke="#fff" stroke-width="13" fill="none"
			><path
				d="M-20 120 630 85M-20 235 600 240M155 -20 150 320M330 -20 325 330M480 -20 455 320"
			/></g
		>
		<path d="M-20 188 600 145" stroke="#f8faf6" stroke-width="23" fill="none" /><path
			d="M-20 188 600 145"
			stroke="#e0d9c6"
			stroke-width="2"
			stroke-dasharray="7 8"
			fill="none"
		/>
		<g fill="#90a09a" font-size="9" font-family="system-ui"
			><text x="205" y="100">SAMPLE DISTRICT</text><text x="350" y="261">QUEZON CITY</text><text
				x="21"
				y="165"
				transform="rotate(-4 21 165)">Commonwealth Avenue</text
			></g
		>
	</svg>
	<span class="map-label"><MapPin size={12} /> Illustrative map</span>
	<div class="map-pin"><span></span><Navigation size={20} fill="currentColor" /></div>
	<div class="map-caption">
		<LocateFixed size={15} /><span
			>{location}<small>Sample location · GPS is not connected</small></span
		>
	</div>
</div>

<style>
	.map-preview {
		height: 245px;
		position: relative;
		border-radius: 12px;
		overflow: hidden;
		background: #eaf0eb;
		border: 1px solid #dee7e2;
	}
	.compact {
		height: 190px;
	}
	.street-map {
		width: 100%;
		height: 100%;
	}
	.map-label {
		position: absolute;
		left: 12px;
		top: 12px;
		padding: 5px 9px;
		border-radius: 5px;
		background: #ffffffee;
		color: #62766e;
		font-size: 12px;
		display: flex;
		align-items: center;
		gap: 5px;
	}
	.map-pin {
		position: absolute;
		left: 50%;
		top: 42%;
		width: 40px;
		height: 40px;
		display: grid;
		place-items: center;
		background: #16786c;
		border: 3px solid white;
		color: white;
		border-radius: 50%;
		box-shadow: 0 0 0 22px #16786c19;
	}
	.map-caption {
		position: absolute;
		bottom: 12px;
		left: 12px;
		right: 12px;
		background: #fffffff5;
		padding: 10px 12px;
		border-radius: 8px;
		display: flex;
		align-items: center;
		gap: 9px;
		font-size: 12px;
		font-weight: 600;
	}
	.map-caption small {
		display: block;
		color: #6d817a;
		font-size: 12px;
		margin-top: 2px;
		font-weight: 400;
	}
</style>
