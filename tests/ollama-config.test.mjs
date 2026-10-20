import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ollamaServerOrigin } from '../src/lib/server/ollama-config.ts';

test('Ollama defaults to localhost only when the setting is absent', () => {
	assert.equal(ollamaServerOrigin(undefined), 'http://127.0.0.1:11434');
	assert.equal(ollamaServerOrigin(''), null);
	assert.equal(ollamaServerOrigin('   '), null);
});

test('Ollama follows the configured origin without a host allowlist', () => {
	for (const address of [
		'http://192.168.254.63:11434',
		'http://10.4.3.2:12345',
		'http://172.20.0.2:11434',
		'http://ollama:11434',
		'https://models.example.com',
		'http://[::1]:11434'
	])
		assert.equal(ollamaServerOrigin(address), address);
	assert.equal(ollamaServerOrigin(' http://192.168.254.63:11434/ '), 'http://192.168.254.63:11434');
});

test('invalid Ollama configuration fails instead of falling back to localhost', () => {
	for (const address of [
		'not-a-url',
		'ftp://models.example.com',
		'file:///tmp/model',
		'http://',
		'http://name:password@models.example.com',
		'http://models.example.com/api/chat',
		'http://models.example.com?token=test',
		'http://models.example.com#fragment'
	])
		assert.equal(ollamaServerOrigin(address), null);
});
