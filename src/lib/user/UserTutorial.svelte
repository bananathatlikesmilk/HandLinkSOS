<script lang="ts">
	import GuidedTutorial from '#lib/components/GuidedTutorial.svelte';
	const steps = [
		{
			title: 'Welcome to HandLink',
			text: 'A quick tour of the buttons that help you and your trusted people. This guide will not send an SOS or place a call.',
			target: ''
		},
		{
			title: 'SOS for me',
			text: 'This requests help for you. HandLink gathers your location, then gives you five seconds to cancel. The true-emergency option skips that countdown.',
			target: '.self-sos'
		},
		{
			title: 'Help someone else',
			text: 'Choose an approved trusted profile to request help for them. For a stranger, use the separate SOS button while you are at the scene.',
			target: '#trusted-title'
		},
		{
			title: 'You press Call',
			text: 'After an SOS is saved, HandLink opens or offers the hotline dialer. You must press Call yourself. HandLink does not answer or carry the call.',
			target: ''
		},
		{
			title: 'Manage your profiles',
			text: 'Keep your personal and medical details up to date here. Add trusted people and approve connections before requesting SOS for them.',
			target: '[data-tutorial="profiles"]'
		},
		{
			title: 'Share your location',
			text: 'Choose approved people and a sharing duration. You can stop sharing at any time. This is separate from sending an SOS.',
			target: '[data-tutorial="location"]'
		},
		{
			title: 'Check your updates',
			text: 'Read incident and location-sharing updates here. Opening the updates marks them as read.',
			target: '[data-tutorial="updates"]'
		},
		{
			title: 'Settings and permissions',
			text: 'Review location, camera and notification access here, or replay this tutorial. The moon/sun icon changes appearance.',
			target: '[data-tutorial="settings"]'
		},
		{
			title: 'Find your SOS history',
			text: 'Your five newest alerts appear here. View full history shows all alerts you sent, including requests for other people.',
			target: '.history-heading'
		}
	];
</script>

<GuidedTutorial
	{steps}
	home="/user/dashboard"
	contentId="user-content"
	safety="Guide only. No SOS, calls or permission changes."
/>
