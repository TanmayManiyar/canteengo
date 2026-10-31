import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const mock = (name) => fileURLToPath(new URL(`./src/mock/${name}.js`, import.meta.url));

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  // `vite --mode mock` swaps Firebase for a fake login so the screens can be tried without any accounts.
  resolve: mode === 'mock' ? { alias: { 'firebase/auth': mock('firebase-auth'), 'firebase/app': mock('firebase-app') } } : {},
  test: { environment: 'jsdom', setupFiles: ['./src/setupTests.js'], globals: true },
}));
