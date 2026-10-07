import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { clearGeneratedCacheGroup } from './generated-cache.mjs';
import { runNodeCli } from './run-node-cli.mjs';

const require = createRequire(import.meta.url);
const playwrightCli = require.resolve('@playwright/test/cli');
const webRoot = fileURLToPath(new URL('..', import.meta.url));
const externalServers = process.env.PLAYWRIGHT_EXTERNAL_SERVERS === '1';

async function cleanE2eCache(stage) {
  try {
    await clearGeneratedCacheGroup('e2e');
    if (stage === 'after') console.log('✓ Playwright cache cleaned');
  } catch (error) {
    console.warn(`Could not clean the Playwright cache ${stage} the test run: ${error.message}`);
  }
}

if (!externalServers) await cleanE2eCache('before');

let exitCode = 1;
try {
  const result = await runNodeCli(playwrightCli, ['test', ...process.argv.slice(2)], {
    cwd: webRoot,
  });
  exitCode = result.exitCode;
} catch (error) {
  console.error(`Failed to run Playwright: ${error.message}`);
} finally {
  if (!externalServers) await cleanE2eCache('after');
}

process.exitCode = exitCode;
