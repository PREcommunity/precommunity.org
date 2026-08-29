import { clearGeneratedCacheGroup } from './generated-cache.mjs';

try {
  await clearGeneratedCacheGroup('all');
  console.log('✓ Generated Next.js and Playwright caches cleaned');
} catch (error) {
  console.error(`Could not clean generated caches: ${error.message}`);
  process.exitCode = 1;
}
