import { Capacitor, registerPlugin } from '@capacitor/core';

export type AccessState = 'granted' | 'denied' | 'prompt' | 'unknown';
export type UserPermissionStatus = {
	location: AccessState;
	camera: AccessState;
	locationEnabled?: boolean;
	cameraEnabled?: boolean;
	overlayAllowed: boolean;
	overlayActive: boolean;
	initialRequested: boolean;
	message: string;
};
interface PermissionsPlugin {
	setAccessEnabled(options: {
		kind: 'location' | 'camera';
		enabled: boolean;
	}): Promise<UserPermissionStatus>;
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

type AccessKind = 'location' | 'camera';
const webAccess = { location: true, camera: true };
function webAccessEnabled(kind: AccessKind) {
	try {
		const saved = localStorage.getItem(`handlink:access:${kind}`);
		if (saved !== null) webAccess[kind] = saved !== 'off';
	} catch {
		/* Keep the in-memory preference when storage is unavailable. */
	}
	return webAccess[kind];
}
export async function assertAccessEnabled(kind: AccessKind) {
	const enabled = nativePermissionsAvailable()
		? (await permissions.status())[`${kind}Enabled`] !== false
		: webAccessEnabled(kind);
	if (!enabled)
		throw new Error(
			`${kind === 'camera' ? 'Camera' : 'Location'} access is off in HandLink Settings.`
		);
}
export async function setAccessEnabled(kind: AccessKind, enabled: boolean) {
	let result: UserPermissionStatus;
	if (nativePermissionsAvailable()) result = await permissions.setAccessEnabled({ kind, enabled });
	else {
		webAccess[kind] = enabled;
		try {
			localStorage.setItem(`handlink:access:${kind}`, enabled ? 'on' : 'off');
		} catch {
			/* The switch still applies for this open app session. */
		}
		result = await getPermissionStatus();
	}
	window.dispatchEvent(new CustomEvent('handlink-access-change', { detail: { kind, enabled } }));
	return result;
}

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
		locationEnabled: webAccessEnabled('location'),
		cameraEnabled: webAccessEnabled('camera'),
		overlayAllowed: false,
		overlayActive: false,
		initialRequested: webAttempted,
		message: ''
	};
}
export async function requestLocationAccess(): Promise<UserPermissionStatus> {
	await assertAccessEnabled('location');
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
	await assertAccessEnabled('camera');
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
			location = webAccessEnabled('location')
				? (await requestLocationAccess()).location
				: (await getPermissionStatus()).location;
		} catch {
			location = 'denied';
		}
		if (generation !== initialGeneration) return getPermissionStatus();
		try {
			camera = webAccessEnabled('camera')
				? (await requestCameraAccess()).camera
				: (await getPermissionStatus()).camera;
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
