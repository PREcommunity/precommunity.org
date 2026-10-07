import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { runNodeCli } from './run-node-cli.mjs';

const require = createRequire(import.meta.url);
const profile = parseEnv(
  readFileSync(new URL('../../../.env.keyword-rehearsal', import.meta.url), 'utf8'),
);

// Next forwards its Node flags into NODE_OPTIONS, which rejects --env-file.
const result = await runNodeCli(
  require.resolve('next/dist/bin/next'),
  ['dev', '--webpack', '-H', '127.0.0.1', '-p', '3012', ...process.argv.slice(2)],
  {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { PATH: process.env.PATH, HOME: process.env.HOME, ...profile, PORT: '3012' },
  },
);
process.exitCode = result.exitCode;
