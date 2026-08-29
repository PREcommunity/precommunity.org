import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { clearGeneratedCacheGroup } from './generated-cache.mjs';
import { runNodeCli } from './run-node-cli.mjs';

const require = createRequire(import.meta.url);
const nextCli = require.resolve('next/dist/bin/next');
const webRoot = fileURLToPath(new URL('..', import.meta.url));

try {
  await clearGeneratedCacheGroup('build');
} catch (error) {
  console.warn(`Could not clean the stale Next.js build cache: ${error.message}`);
}

let exitCode = 1;
try {
  const result = await runNodeCli(nextCli, ['build', ...process.argv.slice(2)], { cwd: webRoot });
  exitCode = result.exitCode;
} catch (error) {
  console.error(`Failed to run the Next.js build: ${error.message}`);
} finally {
  try {
    await clearGeneratedCacheGroup('build');
    console.log('✓ Next.js build cache cleaned');
  } catch (error) {
    console.warn(`Could not clean the Next.js build cache: ${error.message}`);
  }
}

process.exitCode = exitCode;
