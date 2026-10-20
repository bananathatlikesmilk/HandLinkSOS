import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { apiRequest } from '../client/request.ts';

export const pushAvailable = () => Capacitor.getPlatform() === 'android';
let account: string | null = null;
let token = '';
let setup: Promise<void> | null = null;
let queue = Promise.resolve();
let pending: { resolve: (value: string) => void; reject: (error: Error) => void } | null = null;
const listeners: PluginListenerHandle[] = [];
const key = (id: string) => `handlink:push:enabled:${id}`;
const optedIn = (id: string) => localStorage.getItem(key(id)) === 'yes';

function serial(action: () => Promise<void>) {
	const result = queue.then(action);
	queue = result.catch(() => {});
	return result;
}

function initialize() {
	return (setup ??= (async () => {
		listeners.push(
			await PushNotifications.addListener('registration', (value) => {
				token = value.value;
				if (pending) pending.resolve(value.value);
				else {
					const id = account;
					void serial(async () => {
						if (id && account === id && optedIn(id)) await saveToken(value.value);
					}).catch(() => {});
				}
			})
		);
		listeners.push(
			await PushNotifications.addListener('registrationError', () => {
				pending?.reject(
					new Error(
						'Phone notification registration failed. Check internet and Google Play services, then retry.'
					)
				);
			})
		);
		listeners.push(
			await PushNotifications.addListener('pushNotificationReceived', () => {
				// Refresh authorized account data; never display a push payload directly.
				if (account && optedIn(account))
					window.dispatchEvent(new Event('user-notifications-change'));
			})
		);
		listeners.push(
			await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
				// Never navigate to a URL supplied by a push payload.
				if (action.notification.data?.screen === 'notifications')
					window.location.assign('/user/notifications');
			})
		);
	})().catch(async (cause) => {
		for (const listener of listeners.splice(0)) await listener.remove().catch(() => {});
		setup = null;
		throw cause;
	}));
}

async function saveToken(value: string) {
	await apiRequest('/api/push/devices', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ platform: 'android', pushToken: value })
	});
}

async function register(id: string) {
	await initialize();
	if (account !== id) return;
	await PushNotifications.createChannel({
		id: 'handlink_alerts',
		name: 'HandLink alerts',
		importance: 4,
		visibility: 0
	});
	const value = await new Promise<string>((resolve, reject) => {
		const timer = setTimeout(() => {
			pending = null;
			reject(new Error('Phone registration timed out. Check internet and try again.'));
		}, 20000);
		pending = {
			resolve: (value) => {
				clearTimeout(timer);
				pending = null;
				resolve(value);
			},
			reject: (failure) => {
				clearTimeout(timer);
				pending = null;
				reject(failure);
			}
		};
		void PushNotifications.register().catch(() =>
			pending?.reject(new Error('Could not register phone notifications.'))
		);
	});
	if (account === id && optedIn(id)) await saveToken(value);
}

export async function getPushStatus() {
	if (!pushAvailable()) return { configured: false, enabled: false, permission: null };
	const status = await apiRequest<{ configured: boolean; enabled: boolean }>('/api/push/devices');
	const permission = await PushNotifications.checkPermissions();
	return {
		configured: status.configured,
		permission: permission.receive,
		enabled:
			status.enabled && Boolean(account && optedIn(account)) && permission.receive === 'granted'
	};
}

export function enablePush() {
	const id = account;
	return serial(async () => {
		if (!pushAvailable() || !id || id !== account)
			throw new Error('Sign in through the Android app first.');
		const status = await apiRequest<{ configured: boolean }>('/api/push/devices');
		if (!status.configured) throw new Error('Phone notification delivery is not configured yet.');
		const permission = await PushNotifications.requestPermissions();
		if (permission.receive !== 'granted')
			throw new Error('Allow notifications in Android settings, then try again.');
		if (account !== id) return;
		localStorage.setItem(key(id), 'yes');
		try {
			await register(id);
		} catch (failure) {
			localStorage.removeItem(key(id));
			throw failure;
		}
	});
}

export function disablePush() {
	const id = account;
	if (id) localStorage.removeItem(key(id));
	return serial(async () => {
		let failure: unknown;
		try {
			if (id && account === id && token)
				await apiRequest('/api/push/devices', {
					method: 'DELETE',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ platform: 'android', pushToken: token })
				});
		} catch (cause) {
			failure = cause;
		}
		await PushNotifications.unregister();
		await PushNotifications.removeAllDeliveredNotifications();
		token = '';
		if (failure)
			throw new Error(
				'Phone registration was removed. Reconnect and check notification status before enabling again.'
			);
	});
}

export function syncPushAccount(id: string | null) {
	if (!pushAvailable()) return Promise.resolve();
	const previous = account;
	account = id;
	return serial(async () => {
		if (previous && previous !== id) {
			await PushNotifications.unregister();
			await PushNotifications.removeAllDeliveredNotifications();
			token = '';
		}
		if (
			id &&
			id === account &&
			optedIn(id) &&
			(await PushNotifications.checkPermissions()).receive === 'granted'
		) {
			const status = await apiRequest<{ configured: boolean }>('/api/push/devices');
			if (status.configured) await register(id);
		}
	});
}
