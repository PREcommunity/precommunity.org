import type { NextConfig } from 'next';
import { loadEnvFile } from 'node:process';
import path from 'node:path';

const workspaceRoot = path.join(process.cwd(), '../..');
try {
  loadEnvFile(path.join(workspaceRoot, '.env'));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}

const internalApiUrl = (process.env.INTERNAL_API_URL ?? 'http://127.0.0.1:4000').replace(
  /\/+$/,
  '',
);
const disabledX402Module = './lib/disabled-x402.ts';

const publicDeploymentEnvironment = {
  PUBLIC_ESCROW_ADDRESS: process.env.PUBLIC_ESCROW_ADDRESS ?? '',
  PUBLIC_ESCROW_DEPLOYMENT_BLOCK: process.env.PUBLIC_ESCROW_DEPLOYMENT_BLOCK ?? '',
  PUBLIC_PRE_ADDRESS: process.env.PUBLIC_PRE_ADDRESS ?? '',
  PUBLIC_USDC_ADDRESS: process.env.PUBLIC_USDC_ADDRESS ?? '',
  ESCROW_ADDRESS_TESTNET: process.env.ESCROW_ADDRESS_TESTNET ?? '',
  ESCROW_DEPLOYMENT_BLOCK_TESTNET: process.env.ESCROW_DEPLOYMENT_BLOCK_TESTNET ?? '',
  PRE_ADDRESS_TESTNET: process.env.PRE_ADDRESS_TESTNET ?? '',
  USDC_ADDRESS_TESTNET: process.env.USDC_ADDRESS_TESTNET ?? '',
  INITIAL_OWNER_ADDRESS_TESTNET: process.env.INITIAL_OWNER_ADDRESS_TESTNET ?? '',
  TREASURY_ADDRESS_TESTNET: process.env.TREASURY_ADDRESS_TESTNET ?? '',
  CHAIN_CONFIRMATIONS_TESTNET: process.env.CHAIN_CONFIRMATIONS_TESTNET ?? '',
  PUBLIC_INITIAL_OWNER_ADDRESS: process.env.PUBLIC_INITIAL_OWNER_ADDRESS ?? '',
  PUBLIC_TREASURY_ADDRESS: process.env.PUBLIC_TREASURY_ADDRESS ?? '',
  PUBLIC_CHAIN_CONFIRMATIONS: process.env.PUBLIC_CHAIN_CONFIRMATIONS ?? '',
};

const nextConfig: NextConfig = {
  allowedDevOrigins: ['precommunity.test'],
  output: 'standalone',
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  outputFileTracingRoot: workspaceRoot,
  env: publicDeploymentEnvironment,
  transpilePackages: ['@precommunity/shared'],
  turbopack: {
    root: workspaceRoot,
    // Turbopack aliases require module targets rather than Webpack's `false`.
    // These optional CDP payment integrations are not used by the app.
    resolveAlias: {
      '@x402/core/client': disabledX402Module,
      '@x402/evm': disabledX402Module,
      '@x402/evm/exact/client': disabledX402Module,
      '@x402/evm/upto/client': disabledX402Module,
      '@x402/svm/exact/client': disabledX402Module,
    },
  },
  async headers() {
    return [
      {
        source: '/preview/goals/:path*',
        headers: [
          { key: 'Cache-Control', value: 'private, no-store' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
        ],
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${internalApiUrl}/:path*`,
      },
    ];
  },
  webpack(config) {
    // @base-org/account exposes optional x402 integrations through Wagmi's
    // connector barrel. They are not used by this app, so keep them out of the
    // server bundle instead of installing unrelated payment protocols.
    config.resolve.alias = {
      ...config.resolve.alias,
      '@x402/core/client': false,
      '@x402/evm': false,
      '@x402/evm/exact/client': false,
      '@x402/evm/upto/client': false,
      '@x402/svm/exact/client': false,
      '@react-native-async-storage/async-storage': false,
      'pino-pretty': false,
    };
    return config;
  },
};

export default nextConfig;
