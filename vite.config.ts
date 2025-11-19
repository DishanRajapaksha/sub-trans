import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.json';

export default defineConfig({
  plugins: [crx({ manifest })],
  test: {
    environment: 'jsdom',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/content/index.ts'],
      lines: 100,
      functions: 100,
      branches: 100,
      statements: 100
    }
  }
});
