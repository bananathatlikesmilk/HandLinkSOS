import { defineEnvVars } from '@sveltejs/kit/env';

export const variables = defineEnvVars({
	GEMINI_API_KEY: {
		description: 'Private server-only Google Gemini API key.',
		schema: (value) => value
	},
	GEMINI_SUMMARY_MODEL: {
		description: 'Gemini summary model. Defaults to gemini-3.5-flash-lite.',
		schema: (value) => value
	},
	OLLAMA_SERVER_URL: {
		description:
			'Server-only HTTP(S) Ollama origin. Uses the configured address; defaults to http://127.0.0.1:11434 only when absent.',
		schema: (value) => value
	},
	FIREBASE_SERVICE_ACCOUNT_FILE: {
		description:
			'Absolute path to the private Firebase service account JSON. Server only; never package in the APK.',
		schema: (value) => value
	},
	OLLAMA_SUMMARY_MODEL: {
		description:
			'Local Ollama summary model. Defaults to qwen2.5:3b. Cloud models are not supported.',
		schema: (value) => value
	},
	DATABASE_URL: { description: 'The database connection string.' },
	ORIGIN: {
		description: 'The app origin (base URL), e.g. `http://localhost:5173`.'
	},
	BETTER_AUTH_SECRET: {
		description:
			'Secret used to sign tokens. For production use 32 characters generated with high entropy. See [Better Auth installation](https://www.better-auth.com/docs/installation).'
	},
	SMTP_HOST: {
		description: 'SMTP server hostname. Private and optional until email delivery is configured.',
		schema: (value) => value
	},
	SMTP_PORT: {
		description: 'SMTP server port, usually 465 or 587.',
		schema: (value) => value
	},
	SMTP_USER: {
		description: 'SMTP sender account. Never exposed to browser code.',
		schema: (value) => value
	},
	SMTP_PASSWORD: {
		description: 'SMTP credential, such as a Google App Password. Server-only.',
		schema: (value) => value
	},
	SMTP_FROM: {
		description: 'Sender email address used for account verification and password recovery.',
		schema: (value) => value
	}
});
