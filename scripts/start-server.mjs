import fs from 'node:fs';

if (fs.existsSync('.env')) process.loadEnvFile('.env');

const configuredOrigin = process.env.ORIGIN;
let publicUrl;
try {
	publicUrl = new URL(configuredOrigin);
	if (!['http:', 'https:'].includes(publicUrl.protocol) || publicUrl.origin !== configuredOrigin) {
		throw new Error('Invalid origin');
	}
} catch {
	throw new Error('ORIGIN must be an HTTP(S) origin without a path or trailing slash.');
}

// SvelteKit 3 derives the request URL through adapter-node's header settings.
// Supply trusted values ourselves so the same image works with runtime ORIGIN.
process.env.PROTOCOL_HEADER = 'x-handlink-protocol';
process.env.HOST_HEADER = 'x-handlink-host';
process.env.PORT_HEADER = '';

const { server } = await import('../build/index.js');

// Run before the adapter's request listener, preserving its server lifecycle.
// Always replace client-supplied values; never trust forwarded origin headers.
server.prependListener('request', (request) => {
	request.headers['x-handlink-protocol'] = publicUrl.protocol.slice(0, -1);
	request.headers['x-handlink-host'] = publicUrl.host;
});
