import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { deploymentForNetwork } from '@precommunity/shared';
import overrides from '../tests/e2e-deployment.json' with { type: 'json' };
import { runNodeCli } from './run-node-cli.mjs';

const require = createRequire(import.meta.url);
const deployment = deploymentForNetwork('base-sepolia', overrides);
const port = process.env.PLAYWRIGHT_PORT?.trim() || '3100';
if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
  throw new Error('PLAYWRIGHT_PORT must be an integer between 1 and 65535.');
}

const result = await runNodeCli(
  require.resolve('next/dist/bin/next'),
  ['dev', '-H', '127.0.0.1', '-p', port, ...process.argv.slice(2)],
  {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: {
      ...process.env,
      PRECOMMUNITY_NETWORK: deployment.network,
      NEXT_PUBLIC_PRECOMMUNITY_NETWORK: deployment.network,
      INTERNAL_API_URL: 'http://127.0.0.1:4100',
      NEXT_PUBLIC_API_URL: 'http://127.0.0.1:4100',
      NEXT_PUBLIC_BASE_RPC_URL_TESTNET: 'http://127.0.0.1:4100/rpc',
      ESCROW_ADDRESS_TESTNET: deployment.escrowAddress,
      ESCROW_DEPLOYMENT_BLOCK_TESTNET: deployment.deploymentBlock,
      PRE_ADDRESS_TESTNET: deployment.preAddress,
      USDC_ADDRESS_TESTNET: deployment.usdcAddress,
      INITIAL_OWNER_ADDRESS_TESTNET: deployment.owner,
      TREASURY_ADDRESS_TESTNET: deployment.treasury,
      CHAIN_CONFIRMATIONS_TESTNET: String(deployment.confirmations),
      NEXT_DIST_DIR: '.next-e2e',
    },
  },
);
process.exitCode = result.exitCode;
