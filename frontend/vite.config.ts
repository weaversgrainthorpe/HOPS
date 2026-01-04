import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
// @ts-ignore - fs is available in Node.js environment
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));

export default defineConfig({
	plugins: [sveltekit()],
	define: {
		__APP_VERSION__: JSON.stringify(pkg.version)
	},
	server: {
		host: true,
		port: 5173,
		proxy: {
			'/api': {
				target: 'http://localhost:8080',
				changeOrigin: true
			},
			'/backgrounds': {
				target: 'http://localhost:8080',
				changeOrigin: true
			},
			'/presets': {
				target: 'http://localhost:8080',
				changeOrigin: true
			},
			'/icons': {
				target: 'http://localhost:8080',
				changeOrigin: true
			}
		}
	}
});
