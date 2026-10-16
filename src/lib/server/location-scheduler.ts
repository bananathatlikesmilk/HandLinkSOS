import { db } from './db/index.ts';
import { expireLocationSessions } from './location-expiry.ts';

export function startLocationExpiryScheduler() {
	const runtime = globalThis as typeof globalThis & {
		handlinkLocationExpiry?: ReturnType<typeof setInterval>;
	};
	if (runtime.handlinkLocationExpiry) return;
	const sweep = () => {
		try {
			expireLocationSessions(db);
		} catch {
			console.error('Location expiry sweep failed; the next sweep will retry.');
		}
	};
	sweep();
	runtime.handlinkLocationExpiry = setInterval(sweep, 15000);
	runtime.handlinkLocationExpiry.unref();
}
