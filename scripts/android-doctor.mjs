import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const java = process.env.JAVA_HOME
	? path.join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
	: 'java';
const javaResult = spawnSync(java, ['-version'], { encoding: 'utf8' });
const version = (javaResult.stderr || javaResult.stdout || '').match(/version "(\d+)/)?.[1];
const sdk =
	process.env.ANDROID_HOME ||
	process.env.ANDROID_SDK_ROOT ||
	(process.platform === 'win32' && process.env.LOCALAPPDATA
		? path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk')
		: '');
const checks = {
	'Java 21 or newer': !javaResult.error && javaResult.status === 0 && Number(version) >= 21,
	'Android SDK 36': Boolean(
		sdk && fs.existsSync(path.join(sdk, 'platforms', 'android-36', 'android.jar'))
	),
	'Android platform tools': Boolean(
		sdk &&
		fs.existsSync(
			path.join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb')
		)
	)
};
for (const [name, available] of Object.entries(checks))
	console.log(`${available ? 'Ready' : 'Missing'}: ${name}`);
if (Object.values(checks).some((value) => !value)) {
	console.log(
		'Install Android Studio, Android SDK 36 and platform tools. Set JAVA_HOME to its bundled jbr and ANDROID_HOME to your SDK folder.'
	);
	process.exitCode = 1;
}
