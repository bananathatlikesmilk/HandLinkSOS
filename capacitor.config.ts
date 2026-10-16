import type { CapacitorConfig } from '@capacitor/cli';

const serverUrl = process.env.HANDLINK_MOBILE_SERVER_URL;
if (serverUrl) {
	const url = new URL(serverUrl);
	if (
		url.username ||
		url.password ||
		url.search ||
		url.hash ||
		!['https:', 'http:'].includes(url.protocol)
	)
		throw new Error('Use a plain HandLink HTTP(S) URL without credentials, query, or fragment.');
	if (url.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(url.hostname))
		throw new Error(
			'Unencrypted mobile connections are allowed only over localhost USB forwarding.'
		);
}

const config: CapacitorConfig = {
	appId: 'com.handlink.sos',
	appName: 'HandLink',
	webDir: 'mobile-www',
	...(serverUrl
		? {
				server: {
					url: new URL('/user', serverUrl).href,
					cleartext: new URL(serverUrl).protocol === 'http:'
				}
			}
		: {}),
	android: { allowMixedContent: false }
};

export default config;
