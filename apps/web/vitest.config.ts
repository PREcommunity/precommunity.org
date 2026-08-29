import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: import.meta.dirname,
  test: {
    include: ['**/*.test.{ts,tsx,mjs}'],
    exclude: ['tests/**', '.next*/**', 'node_modules/**'],
  },
});
