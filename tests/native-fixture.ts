import type { Page } from '@playwright/test';

export async function installNativeBridge(page: Page) {
	await page.addInitScript(() => {
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
			finishStart: null as (() => void) | null
		};
		Object.assign(globalThis, {
			CapacitorCustomPlatform: { name: 'android' },
			__handlinkNativeTest: state,
			Capacitor: {
				PluginHeaders: [
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
				async nativePromise(plugin: string, method: string, options?: { sessionId: string }) {
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
						state.sessionId = options!.sessionId;
						state.message = 'Screen-off updates active.';
					}
				}
			}
		});
	});
}

export type NativeTestState = {
	active: boolean;
	sessionId: string | null;
	starts: number;
	stops: number;
	statusChecks: number;
	gpsChecks: number;
	dialerAttempts: number;
	denyDialer: boolean;
	deny: boolean;
	delay: boolean;
	finishStart: (() => void) | null;
};
