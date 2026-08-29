import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { clearGeneratedCacheGroup } from './generated-cache.mjs';

const require = createRequire(import.meta.url);
const nextCli = require.resolve('next/dist/bin/next');
const webRoot = fileURLToPath(new URL('..', import.meta.url));
const port = process.env.PORT ?? '3011';
const homeUrl = `http://127.0.0.1:${port}/`;
const retryDelayMs = 500;
const warmupDeadline = Date.now() + 120_000;

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function portIsOpen(portNumber) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port: portNumber });
    let settled = false;
    const finish = (open) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(300, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

async function main() {
  const portNumber = Number(port);
  if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65_535) {
    console.error(`Cannot start Next.js: invalid PORT value "${port}".`);
    process.exitCode = 1;
    return;
  }
  if (await portIsOpen(portNumber)) {
    console.error(`Cannot start Next.js: port ${port} is already in use.`);
    process.exitCode = 1;
    return;
  }

  try {
    await clearGeneratedCacheGroup('development');
  } catch (error) {
    console.warn(`Could not clean the stale Next.js development cache: ${error.message}`);
  }

  const next = spawn(process.execPath, [nextCli, 'dev', '-p', port], {
    cwd: webRoot,
    env: process.env,
    stdio: 'inherit',
  });
  let stopping = false;

  function stop(signal) {
    if (stopping) return;
    stopping = true;
    next.kill(signal);
  }

  process.once('SIGINT', () => stop('SIGINT'));
  process.once('SIGTERM', () => stop('SIGTERM'));

  next.once('exit', async (code, signal) => {
    stopping = true;
    try {
      await clearGeneratedCacheGroup('development');
      console.log('\n✓ Next.js development cache cleaned');
    } catch (error) {
      console.warn(`\nCould not clean the Next.js development cache: ${error.message}`);
    }
    process.exitCode = code ?? (signal === 'SIGINT' || signal === 'SIGTERM' ? 0 : 1);
  });

  next.once('error', (error) => {
    stopping = true;
    console.error(`Failed to start Next.js: ${error.message}`);
    void clearGeneratedCacheGroup('development')
      .catch((cleanupError) =>
        console.warn(`Could not clean the Next.js development cache: ${cleanupError.message}`),
      )
      .finally(() => {
        process.exitCode = 1;
      });
  });

  async function warmHomePage() {
    while (!stopping && Date.now() < warmupDeadline) {
      try {
        const response = await fetch(homeUrl, {
          headers: { 'x-precommunity-dev-warmup': '1' },
          signal: AbortSignal.timeout(30_000),
        });
        await response.body?.cancel();

        console.log(
          response.ok
            ? '\n✓ Home page compiled and ready'
            : `\n→ Home page compiled (warmup HTTP ${response.status})`,
        );
        return;
      } catch {
        await sleep(retryDelayMs);
      }
    }

    if (!stopping) {
      console.warn('\nCould not warm up the home page; it will compile on the first request.');
    }
  }

  void warmHomePage();
}

await main();
