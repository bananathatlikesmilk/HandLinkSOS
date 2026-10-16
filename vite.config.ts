import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-auto';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

const isolatedTest = Boolean(process.env.HANDLINK_TEST_DB);

export default defineConfig({
	cacheDir: isolatedTest ? 'node_modules/.vite-handlink-tests' : 'node_modules/.vite',
	plugins: [
		tailwindcss(),
		sveltekit({
			// Concurrent test servers must not replace the main app's generated private environment.
			outDir: isolatedTest ? '.svelte-kit-tests' : '.svelte-kit',
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true,
				experimental: { async: true }
			},

			// adapter-auto only supports some environments, see https://svelte.dev/docs/kit/adapter-auto for a list.
			// If your environment is not supported, or you settled on a specific environment, switch out the adapter.
			// See https://svelte.dev/docs/kit/adapters for more information about adapters.
			adapter: adapter(),
			experimental: { remoteFunctions: true }
		})
	]
});
