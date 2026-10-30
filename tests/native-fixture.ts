import type { Page } from '@playwright/test';

export async function installNativeBridge(
	page: Page,
	options: { denyInitialPermissions?: boolean } = {}
) {
	await page.addInitScript((options) => {
		const state = {
			active: false,
			sessionId: null as string | null,
			message: '',
			deny: false,
			delay: false,
			starts: 0,
			stops: 0,
			statusChecks: 0,
			gpsChecks: 0,
			dialerAttempts: 0,
			denyDialer: false,
			initialRequests: 0,
			cameraRequests: 0,
			appSettingsOpens: 0,
			locationRequests: 0,
			permissionDeny: options.denyInitialPermissions ?? false,
			cameraPermission: localStorage.getItem('fixture:camera-permission') ?? 'prompt',
			locationPermission: localStorage.getItem('fixture:location-permission') ?? 'prompt',
			locationEnabled: localStorage.getItem('fixture:access:location') !== 'off',
			cameraEnabled: localStorage.getItem('fixture:access:camera') !== 'off',
			overlayAllowed: false,
			overlayActive: false,
			overlayStarts: 0,
			overlayStops: 0,
			overlayDelay: false,
			finishOverlayStart: null as (() => void) | null,
			pushPermission: 'prompt',
			pushRequests: 0,
			pushRegistrations: 0,
			pushUnregisters: 0,
			pushDeny: false,
			finishStart: null as (() => void) | null
		};
		const pushListeners: Record<string, (value: unknown) => void> = {};
		Object.assign(globalThis, {
			CapacitorCustomPlatform: { name: 'android' },
			__handlinkNativeTest: state,
			Capacitor: {
				PluginHeaders: [
					{
						name: 'HandLinkPermissions',
						methods: [
							'status',
							'setAccessEnabled',
							'requestInitial',
							'requestCamera',
							'requestLocation',
							'openAppSettings',
							'openOverlaySettings',
							'startOverlay',
							'stopOverlay'
						].map((name) => ({ name, rtype: 'promise' }))
					},
					{
						name: 'PushNotifications',
						methods: [
							{ name: 'addListener', rtype: 'callback' },
							...[
								'removeListener',
								'checkPermissions',
								'requestPermissions',
								'register',
								'unregister',
								'createChannel',
								'removeAllDeliveredNotifications'
							].map((name) => ({ name, rtype: 'promise' }))
						]
					},
					{ name: 'HandLinkPhone', methods: [{ name: 'openDialer', rtype: 'promise' }] },
					{
						name: 'Geolocation',
						methods: [
							{ name: 'requestPermissions', rtype: 'promise' },
							{ name: 'getCurrentPosition', rtype: 'promise' }
						]
					},
					{
						name: 'HandLinkLocation',
						methods: [
							{ name: 'start', rtype: 'promise' },
							{ name: 'stop', rtype: 'promise' },
							{ name: 'status', rtype: 'promise' }
						]
					}
				],
				nativeCallback(
					plugin: string,
					method: string,
					options: { eventName: string },
					callback: (value: unknown) => void
				) {
					if (plugin === 'PushNotifications' && method === 'addListener')
						pushListeners[options.eventName] = callback;
					return 'fixture-listener';
				},
				async nativePromise(
					plugin: string,
					method: string,
					options?: { sessionId?: string; kind?: 'location' | 'camera'; enabled?: boolean }
				) {
					if (plugin === 'HandLinkPermissions') {
						if (method === 'setAccessEnabled' && options?.kind) {
							state[`${options.kind}Enabled`] = options.enabled === true;
							localStorage.setItem(
								`fixture:access:${options.kind}`,
								options.enabled ? 'on' : 'off'
							);
							if (options.kind === 'location' && !options.enabled) {
								state.active = false;
								state.sessionId = null;
								state.stops++;
							}
						}
						const initialKey = 'fixture:initial-permissions';
						if (method === 'requestInitial' && !localStorage.getItem(initialKey)) {
							state.initialRequests++;
							localStorage.setItem(initialKey, 'yes');
							state.cameraPermission = state.locationPermission = state.permissionDeny
								? 'denied'
								: 'granted';
						}
						if (method === 'openAppSettings') state.appSettingsOpens++;
						if (method === 'requestCamera') {
							state.cameraRequests++;
							state.cameraPermission = state.permissionDeny ? 'denied' : 'granted';
						}
						if (method === 'requestLocation') {
							state.locationRequests++;
							state.locationPermission = state.permissionDeny ? 'denied' : 'granted';
						}
						if (method === 'openOverlaySettings') state.overlayAllowed = true;
						if (method === 'startOverlay') {
							if (!state.overlayAllowed) throw new Error('Allow display over other apps first.');
							state.overlayStarts++;
							if (state.overlayDelay)
								await new Promise<void>((resolve) => {
									state.finishOverlayStart = resolve;
								});
							state.overlayActive = true;
						}
						if (method === 'stopOverlay') {
							state.overlayStops++;
							state.overlayActive = false;
						}
						// Android grants survive WebView navigation; keep the simulation consistent.
						localStorage.setItem('fixture:camera-permission', state.cameraPermission);
						localStorage.setItem('fixture:location-permission', state.locationPermission);
						return {
							location: state.locationPermission,
							camera: state.cameraPermission,
							cameraEnabled: state.cameraEnabled,
							locationEnabled: state.locationEnabled,
							overlayAllowed: state.overlayAllowed,
							overlayActive: state.overlayActive,
							initialRequested: Boolean(localStorage.getItem(initialKey)),
							message: ''
						};
					}
					if (plugin === 'PushNotifications') {
						if (method === 'checkPermissions') return { receive: state.pushPermission };
						if (method === 'requestPermissions') {
							state.pushRequests++;
							state.pushPermission = state.pushDeny ? 'denied' : 'granted';
							return { receive: state.pushPermission };
						}
						if (method === 'register') {
							state.pushRegistrations++;
							queueMicrotask(() =>
								pushListeners.registration?.({ value: 'fixture-push-token-12345678901234567890' })
							);
						}
						if (method === 'unregister') state.pushUnregisters++;
						return;
					}
					if (plugin === 'HandLinkPhone' && method === 'openDialer') {
						state.dialerAttempts++;
						if (state.denyDialer) throw new Error('No dialer available.');
						return;
					}
					if (plugin === 'Geolocation') {
						if (method === 'requestPermissions')
							return { location: 'granted', coarseLocation: 'granted' };
						state.gpsChecks++;
						return {
							timestamp: Date.now(),
							coords: {
								latitude: 14.5995,
								longitude: 120.9842,
								accuracy: 12,
								altitude: null,
								altitudeAccuracy: null,
								heading: null,
								speed: null
							}
						};
					}
					if (method === 'status') {
						state.statusChecks++;
						return { active: state.active, sessionId: state.sessionId, message: state.message };
					}
					if (method === 'stop') {
						state.stops++;
						state.active = false;
						state.sessionId = null;
						state.message = 'Screen-off updates disabled.';
						return;
					}
					if (method === 'start') {
						state.starts++;
						if (state.deny)
							throw new Error('Allow location and notifications in Android settings.');
						if (state.delay)
							await new Promise<void>((resolve) => {
								state.finishStart = resolve;
							});
						state.active = true;
						state.sessionId = options!.sessionId!;
						state.message = 'Screen-off updates active.';
					}
				}
			}
		});
	}, options);
}

export type NativeTestState = {
	locationEnabled: boolean;
	cameraEnabled: boolean;
	appSettingsOpens: number;
	initialRequests: number;
	cameraRequests: number;
	locationRequests: number;
	permissionDeny: boolean;
	cameraPermission: string;
	locationPermission: string;
	overlayAllowed: boolean;
	overlayActive: boolean;
	overlayStarts: number;
	overlayStops: number;
	overlayDelay: boolean;
	finishOverlayStart: (() => void) | null;
	active: boolean;
	sessionId: string | null;
	starts: number;
	stops: number;
	statusChecks: number;
	gpsChecks: number;
	dialerAttempts: number;
	denyDialer: boolean;
	pushRequests: number;
	pushRegistrations: number;
	pushUnregisters: number;
	pushDeny: boolean;
	deny: boolean;
	delay: boolean;
	finishStart: (() => void) | null;
};
