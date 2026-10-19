import { Capacitor, registerPlugin } from '@capacitor/core';

export type AccessState = 'granted' | 'denied' | 'prompt' | 'unknown';
export type UserPermissionStatus = {
	location: AccessState;
	camera: AccessState;
	overlayAllowed: boolean;
	overlayActive: boolean;
	initialRequested: boolean;
	message: string;
};
interface PermissionsPlugin {
	status(): Promise<UserPermissionStatus>;
	requestInitial(): Promise<UserPermissionStatus>;
	requestLocation(): Promise<UserPermissionStatus>;
	requestCamera(): Promise<UserPermissionStatus>;
	openAppSettings(): Promise<void>;
	openOverlaySettings(): Promise<void>;
	startOverlay(): Promise<void>;
	stopOverlay(): Promise<void>;
}
const permissions = registerPlugin<PermissionsPlugin>('HandLinkPermissions');
const initialKey = 'handlink:initial-device-permissions:v1';
let initialAttempt: Promise<UserPermissionStatus> | null = null;
let webAttempted = false;
let overlayGeneration = 0;
let initialGeneration = 0;
export const nativePermissionsAvailable = () => Capacitor.getPlatform() === 'android';

async function browserState(name: PermissionName): Promise<AccessState> {
	try {
		return (await navigator.permissions.query({ name })).state;
	} catch {
		return 'unknown';
	}
}
export async function getPermissionStatus(): Promise<UserPermissionStatus> {
	if (nativePermissionsAvailable()) return permissions.status();
	const [location, camera] = await Promise.all([
		browserState('geolocation'),
		browserState('camera' as PermissionName)
	]);
	return {
		location,
		camera,
		overlayAllowed: false,
		overlayActive: false,
		initialRequested: webAttempted,
		message: ''
	};
}
export async function requestLocationAccess(): Promise<UserPermissionStatus> {
	if (nativePermissionsAvailable()) return permissions.requestLocation();
	if (!navigator.geolocation)
		throw new Error('Location access requires a supported browser and HTTPS.');
	await new Promise<void>((resolve, reject) =>
		navigator.geolocation.getCurrentPosition(
			() => resolve(),
			() => reject(new Error('Allow location in your browser site settings, then retry.')),
			{ timeout: 10000, maximumAge: 60000, enableHighAccuracy: false }
		)
	);
	return { ...(await getPermissionStatus()), location: 'granted' };
}
export async function requestCameraAccess(): Promise<UserPermissionStatus> {
	if (nativePermissionsAvailable()) return permissions.requestCamera();
	if (!navigator.mediaDevices?.getUserMedia)
		throw new Error('Camera access requires a supported browser and HTTPS.');
	const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
	// A permission check must never leave the camera recording or streaming.
	for (const track of stream.getTracks()) track.stop();
	return { ...(await getPermissionStatus()), camera: 'granted' };
}
export function requestInitialPermissions(): Promise<UserPermissionStatus> {
	if (initialAttempt) return initialAttempt;
	const generation = ++initialGeneration;
	initialAttempt = (async () => {
		if (nativePermissionsAvailable()) return permissions.requestInitial();
		try {
			webAttempted ||= localStorage.getItem(initialKey) === 'attempted';
		} catch {
			/* Private browsing may disable storage. */
		}
		if (webAttempted) return getPermissionStatus();
		webAttempted = true;
		try {
			localStorage.setItem(initialKey, 'attempted');
		} catch {
			/* Keep the in-memory guard. */
		}
		// Ask sequentially; declining one permission must not prevent requesting the other.
		let location: AccessState;
		let camera: AccessState;
		try {
			location = (await requestLocationAccess()).location;
		} catch {
			location = 'denied';
		}
		if (generation !== initialGeneration) return getPermissionStatus();
		try {
			camera = (await requestCameraAccess()).camera;
		} catch {
			camera = 'denied';
		}
		return { ...(await getPermissionStatus()), location, camera };
	})().finally(() => {
		initialAttempt = null;
	});
	return initialAttempt;
}
export async function openApplicationSettings() {
	if (nativePermissionsAvailable()) return permissions.openAppSettings();
	throw new Error(
		'Open this website’s camera and location permissions in your browser site settings.'
	);
}
export async function openOverlaySettings() {
	if (!nativePermissionsAvailable())
		throw new Error('The floating button requires the HandLink Android app.');
	await permissions.openOverlaySettings();
}
export async function startFloatingButton() {
	if (!nativePermissionsAvailable())
		throw new Error('The floating button requires the HandLink Android app.');
	const generation = ++overlayGeneration;
	await permissions.startOverlay();
	if (generation !== overlayGeneration) {
		await permissions.stopOverlay();
		throw new Error('Floating button request was cancelled.');
	}
}
export async function stopFloatingButton() {
	overlayGeneration++;
	initialGeneration++;
	if (nativePermissionsAvailable()) await permissions.stopOverlay();
}
