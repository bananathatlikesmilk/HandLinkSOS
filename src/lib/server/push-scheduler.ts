import { db } from './db/index.ts';
import { deliverPushNotifications } from './push-delivery.ts';
import { firebasePushConfigured, sendFirebasePush } from './firebase-push.ts';

export function startPushScheduler() {
	const runtime = globalThis as typeof globalThis & {
		handlinkPushTimer?: ReturnType<typeof setInterval>;
	};
	if (runtime.handlinkPushTimer) return;
	let running = false;
	const sweep = async () => {
		if (running || !firebasePushConfigured()) return;
		running = true;
		try {
			await deliverPushNotifications(db, sendFirebasePush);
		} catch {
			console.error('Push delivery sweep failed; queued alerts will retry.');
		} finally {
			running = false;
		}
	};
	runtime.handlinkPushTimer = setInterval(() => {
		void sweep();
	}, 5000);
	runtime.handlinkPushTimer.unref();
}
