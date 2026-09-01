import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: import.meta.dirname,
  resolve: { alias: { '@': import.meta.dirname } },
  esbuild: { jsx: 'automatic' },
  test: {
    include: ['**/*.test.{ts,tsx,mjs}'],
    exclude: ['tests/**', '.next*/**', 'node_modules/**'],
  },
});
