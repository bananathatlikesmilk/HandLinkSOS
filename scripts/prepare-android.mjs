import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const server = process.env.HANDLINK_MOBILE_SERVER_URL || 'http://localhost:5173';
// Capacitor config validates HTTPS and restricts HTTP to localhost USB forwarding.
const cli = fileURLToPath(new URL('../node_modules/@capacitor/cli/bin/capacitor', import.meta.url));
const result = spawnSync(process.execPath, [cli, 'sync', 'android'], {
	env: { ...process.env, HANDLINK_MOBILE_SERVER_URL: server },
	stdio: 'inherit'
});
if (result.error) throw result.error;
if (result.status) process.exit(result.status);
console.log(
	'Android client prepared. Start pnpm dev, connect the phone by USB, and run adb reverse tcp:5173 tcp:5173.'
);
console.log(
	'Then open Android Studio with pnpm android:open and install the debug app on your phone.'
);
