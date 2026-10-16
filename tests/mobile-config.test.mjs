import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

function configuration(url) {
	return spawnSync(
		process.execPath,
		[
			'--input-type=module',
			'-e',
			"const {default:config}=await import('./capacitor.config.ts');console.log(JSON.stringify(config));"
		],
		{
			env: { ...process.env, HANDLINK_MOBILE_SERVER_URL: url ?? '' },
			encoding: 'utf8'
		}
	);
}

test('mobile config packages a safe setup page unless a server is explicitly supplied', () => {
	const result = configuration();
	assert.equal(result.status, 0, result.stderr);
	const config = JSON.parse(result.stdout);
	assert.equal(config.server, undefined);
	assert.equal(config.webDir, 'mobile-www');
	assert.equal(config.android.allowMixedContent, false);
});

test('USB localhost and HTTPS origins start in the User portal', () => {
	for (const url of [
		'http://localhost:5173',
		'http://127.0.0.1:5173',
		'https://handlink.example.com'
	]) {
		const result = configuration(url);
		assert.equal(result.status, 0, result.stderr);
		const config = JSON.parse(result.stdout);
		assert.equal(config.server.url, new URL('/user', url).href);
		assert.equal(config.server.cleartext, url.startsWith('http:'));
	}
});

test('mobile config rejects insecure remote servers, credentials, URL fragments, queries and executable schemes', () => {
	for (const url of [
		'http://192.168.1.10:5173',
		'http://localhost.attacker.example',
		'https://user:password@example.com',
		'https://example.com?token=test',
		'https://example.com#injected',
		'javascript:alert(1)',
		'file:///etc/passwd',
		'not-a-url'
	])
		assert.notEqual(configuration(url).status, 0);
});
