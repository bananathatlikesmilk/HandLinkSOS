import { Capacitor, registerPlugin } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import type { SharedLocationSession } from '../sharing.ts';

export type NativeSharingStatus = { active: boolean; sessionId: string | null; message: string };
interface NativeLocationPlugin {
	start(options: { sessionId: string; expiresAt: number }): Promise<void>;
	stop(): Promise<void>;
	status(): Promise<NativeSharingStatus>;
}

const locationService = registerPlugin<NativeLocationPlugin>('HandLinkLocation');
let nativeGeneration = 0;
export const nativeBackgroundAvailable = () => Capacitor.getPlatform() === 'android';

export async function getDeviceLocation(): Promise<GeolocationPosition> {
	if (Capacitor.isNativePlatform()) {
		const permission = await Geolocation.requestPermissions({ permissions: ['location'] });
		if (permission.location !== 'granted' && permission.coarseLocation !== 'granted')
			throw new Error('Allow location access in Android settings, then try again.');
		const result = await Geolocation.getCurrentPosition({
			enableHighAccuracy: permission.location === 'granted',
			maximumAge: 0,
			timeout: 15000
		});
		return {
			timestamp: result.timestamp,
			coords: {
				latitude: result.coords.latitude,
				longitude: result.coords.longitude,
				accuracy: result.coords.accuracy,
				altitude: result.coords.altitude,
				altitudeAccuracy: result.coords.altitudeAccuracy ?? null,
				heading: result.coords.heading,
				speed: result.coords.speed,
				toJSON: () => ({ ...result.coords })
			},
			toJSON: () => ({ ...result })
		};
	}
	if (!navigator.geolocation)
		throw new Error('Location is unavailable. Use HTTPS or localhost and allow location access.');
	return new Promise((resolve, reject) =>
		navigator.geolocation.getCurrentPosition(
			resolve,
			() =>
				reject(
					new Error(
						'Could not get your location. Allow location access and check location services.'
					)
				),
			{ enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
		)
	);
}

export async function enableNativeSharing(session: SharedLocationSession) {
	if (!nativeBackgroundAvailable())
		throw new Error('Screen-off updates require the HandLink Android app.');
	if (
		!session.isOwner ||
		session.status !== 'active' ||
		Date.parse(session.expiresAt) <= Date.now()
	)
		throw new Error('Start an active sharing session first.');
	const generation = ++nativeGeneration;
	await locationService.start({ sessionId: session.id, expiresAt: Date.parse(session.expiresAt) });
	if (generation !== nativeGeneration) {
		await locationService.stop();
		throw new Error('Screen-off update request was cancelled.');
	}
}
export async function disableNativeSharing() {
	nativeGeneration++;
	if (nativeBackgroundAvailable()) await locationService.stop();
}
export async function getNativeSharingStatus(): Promise<NativeSharingStatus> {
	return nativeBackgroundAvailable()
		? locationService.status()
		: { active: false, sessionId: null, message: '' };
}
