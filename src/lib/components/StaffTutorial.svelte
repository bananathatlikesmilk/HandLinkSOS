<script lang="ts">
	import { page } from '$app/state';
	import GuidedTutorial from './GuidedTutorial.svelte';
	let { role }: { role: 'admin' | 'dispatch' } = $props();
	const central = $derived(page.data.account?.centralAdmin === true);
	const provincial = $derived(page.data.account?.provincialDispatcher === true);
	const home = $derived(role === 'admin' ? ('/admin' as const) : ('/dispatch' as const));
	const link = (path: string) => `[data-tutorial-link="${path}"], .mobile-menu`;
	const steps = $derived(
		role === 'admin'
			? [
					{
						title: 'Welcome, Administrator',
						text: central
							? 'Oversee accounts and incidents across LGUs. This guide explains your workspace without changing any records. On small screens, use Menu to find navigation.'
							: 'Oversee accounts and incidents in your assigned LGU. This guide changes no records. On small screens, use Menu to find navigation.',
						target: ''
					},
					{
						title: 'Read your dashboard',
						text: 'These counts summarize the accounts and incidents you are allowed to see. They refresh automatically; use Refresh to check again.',
						target: '.summary-grid'
					},
					{
						title: 'Monitor SOS alerts',
						text: 'Open SOS alerts to monitor cases, locations and handling dispatchers. Admin oversight does not replace the dispatcher’s caller confirmation or response work.',
						target: link('/admin/alerts')
					},
					{
						title: 'Review incident reports',
						text: 'Read saved case records and confirmed response updates. Apply filters before downloading a PDF. Admin reports are read-only.',
						target: link('/admin/reports')
					},
					{
						title: 'Manage staff accounts',
						text: central
							? 'Create and manage staff accounts and their office assignments. Check the role and LGU carefully before saving.'
							: 'Manage staff accounts within your assigned LGU. You cannot administer other LGUs or central settings.',
						target: link('/admin/accounts')
					},
					...(central
						? [
								{
									title: 'LGUs and routing',
									text: 'Add municipalities and valid GPS boundaries here. GPS suggests the municipality; provincial dispatch keeps and coordinates the case through official channels.',
									target: link('/admin/lgus')
								},
								{
									title: 'Choose the AI provider',
									text: 'AI settings chooses the system-wide summary provider. Dispatchers must review generated drafts. Cloud providers can receive report information only through the existing consent flow.',
									target: link('/admin/ai')
								},
								{
									title: 'Set the SOS hotline',
									text: 'Set the number offered by the SOS phone dialer. Verify the official hotline before saving. Users still press Call themselves.',
									target: link('/admin/emergency-phone')
								}
							]
						: []),
					{
						title: 'Secure your account',
						text: 'Manage your authenticator and recovery codes in Account security. Never share passwords or verification codes.',
						target: link('/admin/security')
					},
					{
						title: 'Replay whenever needed',
						text: 'My profile shows your account and Replay tutorial. Your office assignment appears in navigation. The moon/sun icon changes appearance.',
						target: link('/admin/profile')
					}
				]
			: [
					{
						title: 'Welcome, Dispatcher',
						text: provincial
							? 'Receive provincial SOS alerts, confirm information and coordinate response. Calls and municipal hotline contact use your office’s existing systems. This guide changes no cases.'
							: 'Handle the SOS cases available to your assigned LGU. Calls use your office’s existing systems. This guide changes no cases. Use Menu on small screens.',
						target: ''
					},
					{
						title: 'Find incoming alerts',
						text: 'Use the list, search and filters to find a case. Reading an alert does not accept it. Your account’s LGU and assignment determine what you can access.',
						target: '#incident-list-heading'
					},
					{
						title: 'Watch unclaimed alerts',
						text: 'The warning counts waiting alerts across filters and pages. Enable warning sound if needed. Acknowledge only silences your current warning; it does not claim a case.',
						target: '.unclaimed-panel'
					},
					{
						title: 'Confirm the caller',
						text: 'Verify the caller through your official call system, then accept and confirm the incident. Registered sensitive details stay protected until authorized confirmation.',
						target: ''
					},
					{
						title: 'Verify who needs help',
						text: 'Check whether SOS is for the caller, a trusted person or a stranger. Verify the emergency location. A trusted person’s location must come from their available shared location, not the sender’s GPS.',
						target: ''
					},
					{
						title: 'Record important notes',
						text: 'Save accurate caller details and coordination updates in Additional information. Notes autosave. Check the saved indicator and resolve any save conflict before leaving.',
						target: ''
					},
					{
						title: 'Coordinate outside HandLink',
						text: 'Contact municipalities and emergency services through official phone or radio channels. HandLink provides information and records updates; it does not answer calls or dispatch vehicles automatically.',
						target: ''
					},
					{
						title: 'Confirm response progress',
						text: 'Record On route only after confirmed departure. Resolve only after the final outcome is confirmed. Resolution becomes available after On route; do not infer progress from elapsed time.',
						target: ''
					},
					{
						title: 'Review your case reports',
						text: 'Use Incident reports for saved notes, reviewed AI drafts and filtered PDFs. Resolved notes stay locked; authorized dated addenda preserve later corrections.',
						target: link('/dispatch/reports')
					},
					{
						title: 'Your profile and replay',
						text: 'My profile shows your account and Replay tutorial. Account security manages MFA and recovery codes. Your office assignment appears in navigation. Use Menu on small screens.',
						target: link('/dispatch/profile')
					}
				]
	);
</script>

<GuidedTutorial
	{steps}
	{home}
	contentId="main-content"
	safety="Guide only. No case, account, setting or call is changed."
/>
