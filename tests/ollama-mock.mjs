import Database from 'better-sqlite3';

if (
	!process.env.HANDLINK_TEST_DB ||
	process.env.DATABASE_URL !== process.env.HANDLINK_TEST_DB ||
	process.env.OLLAMA_SUMMARY_MODEL !== 'qwen2.5:3b'
)
	throw new Error('AI mock requires the isolated test database and local test model.');
const originalFetch = globalThis.fetch;
globalThis.fetch = async function (input, options) {
	const url = String(typeof input === 'string' || input instanceof URL ? input : input.url);
	if (url.startsWith('https://api.openai.com/'))
		throw new Error('Cloud AI is forbidden in local summary tests.');
	const gemini = url.startsWith('https://generativelanguage.googleapis.com/');
	if (
		gemini &&
		(url !==
			'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent' ||
			options?.headers?.['x-goog-api-key'] !== 'isolated-gemini-key-not-real')
	)
		throw new Error('Gemini tests require the exact mocked model and fake credential.');
	if (!gemini && url !== 'http://127.0.0.1:11434/api/chat') return originalFetch(input, options);
	const db = new Database(process.env.HANDLINK_TEST_DB);
	let mode, delay;
	try {
		db.exec(
			"CREATE TABLE IF NOT EXISTS test_ai_provider (id INTEGER PRIMARY KEY,mode TEXT NOT NULL DEFAULT 'success',delay_ms INTEGER NOT NULL DEFAULT 0,calls INTEGER NOT NULL DEFAULT 0,last_payload TEXT)"
		);
		db.prepare('INSERT OR IGNORE INTO test_ai_provider (id) VALUES (1)').run();
		({ mode, delay_ms: delay } = db
			.prepare('SELECT mode,delay_ms FROM test_ai_provider WHERE id=1')
			.get());
		db.prepare('UPDATE test_ai_provider SET calls=calls+1,last_payload=? WHERE id=1').run(
			String(options?.body)
		);
	} finally {
		db.close();
	}
	if (mode === 'live') {
		if (gemini) throw new Error('Live Gemini requests are forbidden in tests.');
		if (process.env.HANDLINK_LIVE_OLLAMA !== '1')
			throw new Error('Real local inference requires explicit opt-in.');
		return originalFetch(input, options);
	}
	if (delay)
		await new Promise((resolve, reject) => {
			const timer = setTimeout(resolve, delay);
			options?.signal?.addEventListener(
				'abort',
				() => {
					clearTimeout(timer);
					reject(new Error('Test request aborted'));
				},
				{ once: true }
			);
		});
	if (gemini) {
		if (mode === 'failure') return new Response('{}', { status: 503 });
		if (mode === 'quota') return new Response('{}', { status: 429 });
		if (mode === 'bad-key') return new Response('{}', { status: 403 });
		const { sentences } = JSON.parse(JSON.parse(options.body).contents[0].parts[0].text);
		const content =
			mode === 'malformed'
				? 'not json'
				: JSON.stringify({
						summary:
							mode === 'rewrite'
								? 'Chest pain is reported and assistance requested.'
								: [...new Set(sentences.map(({ text }) => text))].join(' '),
						sentenceIds:
							mode === 'invalid-selection' ? [sentences.length] : sentences.map(({ id }) => id)
					});
		return Response.json({
			candidates: [
				{
					finishReason: mode === 'incomplete' ? 'MAX_TOKENS' : 'STOP',
					content: { role: 'model', parts: [{ text: content }] }
				}
			]
		});
	}
	if (mode === 'failure') return new Response('{}', { status: 503 });
	if (mode === 'missing-model') return new Response('{}', { status: 404 });
	if (mode === 'offline') throw new TypeError('Isolated Ollama offline');
	if (mode === 'malformed')
		return Response.json({
			done: true,
			done_reason: 'stop',
			message: { role: 'assistant', content: 'not json' }
		});
	if (mode === 'refusal')
		return Response.json({
			done: true,
			done_reason: 'stop',
			message: { role: 'assistant', content: 'I cannot summarize this.' }
		});
	if (mode === 'incomplete')
		return Response.json({
			done: true,
			done_reason: 'length',
			message: { role: 'assistant', content: '{"summary":"Incomplete draft"}' }
		});
	const { sentences } = JSON.parse(JSON.parse(options.body).messages[1].content);
	const selection =
		mode === 'identifiers'
			? {
					summary:
						'Casey Reyes reports chest pain. Contact casey@example.com at +639171234567. GPS 14.5995,120.9842.'
				}
			: {
					summary:
						mode === 'rewrite'
							? 'Chest pain is reported and assistance requested.'
							: mode === 'copied'
								? sentences.map(({ text }) => text).join(' ')
								: [...new Set(sentences.map(({ text }) => text))].join(' '),
					sentenceIds:
						mode === 'invalid-selection'
							? [sentences.length]
							: mode === 'duplicate-selection'
								? [0, 0]
								: sentences.map(({ id }) => id)
				};
	if (mode === 'extra-fields') selection.unexpected = 'not part of the response contract';
	return Response.json({
		done: true,
		done_reason: 'stop',
		message: { role: 'assistant', content: JSON.stringify(selection) }
	});
};
