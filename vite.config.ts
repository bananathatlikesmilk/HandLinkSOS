import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-node';
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

			adapter: adapter(),
			experimental: { remoteFunctions: true }
		})
	]
});
