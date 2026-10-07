import { randomBytes, randomUUID } from 'node:crypto';
import { chmod, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs, parseEnv } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const REHEARSAL_SCHEMA = 'keyword_rehearsal_20261007';

export function keywordMarketManifestName(name = '') {
  if (typeof name !== 'string' || (name !== '' && !/^[a-z0-9][a-z0-9-]{0,63}$/.test(name))) {
    throw new Error('Deployment name must contain 1–64 lowercase letters, digits or hyphens');
  }
  return `base-sepolia.keyword-market-v1${name ? `.${name}` : ''}.json`;
}

export function selectKeywordMarketDeploymentName(args, previous = {}) {
  const { values } = parseArgs({ args, options: { 'deployment-name': { type: 'string' } } });
  const name = values['deployment-name'] ?? previous.KEYWORD_MARKET_DEPLOYMENT_NAME_TESTNET ?? '';
  keywordMarketManifestName(name);
  return name;
}

function address(value, label) {
  if (!/^0x[a-fA-F0-9]{40}$/.test(value ?? '') || /^0x0{40}$/.test(value)) {
    throw new Error(`${label} must be a nonzero address`);
  }
  return value;
}

function localUrl(value, protocol, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} is missing or invalid`);
  }
  if (
    !protocol.includes(url.protocol) ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  ) {
    throw new Error(`${label} must point to an existing local service`);
  }
  return url;
}

function secret(previous, excluded) {
  return typeof previous === 'string' &&
    previous.length >= 32 &&
    !/[\r\n"\\]/.test(previous) &&
    !excluded.includes(previous)
    ? previous
    : randomBytes(48).toString('hex');
}

/** Builds an isolated profile without changing files, connecting to services or copying signing keys. */
export function buildKeywordRehearsalProfile(
  main,
  previous = {},
  manifest = null,
  deploymentName = previous.KEYWORD_MARKET_DEPLOYMENT_NAME_TESTNET ?? '',
) {
  keywordMarketManifestName(deploymentName);
  if (deploymentName && manifest === null) {
    throw new Error('Named Keyword Market deployment requires its confirmed manifest');
  }
  const database = localUrl(main.DATABASE_URL, ['postgresql:', 'postgres:'], 'DATABASE_URL');
  if (database.pathname !== '/precommunity' || database.searchParams.has('options')) {
    throw new Error(
      'Rehearsal requires the existing precommunity database without search_path overrides',
    );
  }
  database.searchParams.set('schema', REHEARSAL_SCHEMA);
  const redis = new URL('redis://127.0.0.1:6382/2');
  const pre = address(main.PRE_ADDRESS_TESTNET, 'PRE_ADDRESS_TESTNET');
  const safe = address(main.SAFE_ADDRESS_TESTNET, 'SAFE_ADDRESS_TESTNET');
  const escrow = address(main.ESCROW_ADDRESS_TESTNET, 'ESCROW_ADDRESS_TESTNET');
  if (!/^[1-9][0-9]*$/.test(main.ESCROW_DEPLOYMENT_BLOCK_TESTNET ?? '')) {
    throw new Error('ESCROW_DEPLOYMENT_BLOCK_TESTNET must be a positive block');
  }
  let market = '',
    marketBlock = '';
  if (manifest) {
    if (
      manifest.schema !== 'precommunity.keyword-market-deployment.v1' ||
      manifest.stage !== 'confirmed' ||
      manifest.network !== 'base-sepolia' ||
      manifest.chainId !== 84532 ||
      manifest.transactionStatus !== 1 ||
      (manifest.startPaused !== undefined && typeof manifest.startPaused !== 'boolean') ||
      !Number.isSafeInteger(manifest.deploymentBlock) ||
      manifest.deploymentBlock <= 0 ||
      !Number.isInteger(manifest.requiredConfirmations) ||
      manifest.requiredConfirmations < 1 ||
      !Number.isInteger(manifest.confirmations) ||
      manifest.confirmations < manifest.requiredConfirmations
    ) {
      throw new Error('Keyword Market manifest must identify a confirmed Base Sepolia deployment');
    }
    if (
      address(manifest.preAddress, 'Manifest PRE').toLowerCase() !== pre.toLowerCase() ||
      address(manifest.owner, 'Manifest owner').toLowerCase() !== safe.toLowerCase()
    ) {
      throw new Error('Keyword Market manifest PRE or Safe differs from the configured testnet');
    }
    market = address(manifest.contractAddress, 'Manifest contract');
    if ([pre, safe].some((value) => value.toLowerCase() === market.toLowerCase())) {
      throw new Error('Keyword Market manifest contract cannot be the PRE token or Safe');
    }
    marketBlock = String(manifest.deploymentBlock);
  }
  let rpc;
  try {
    rpc = new URL(main.BASE_RPC_URL_TESTNET || 'https://sepolia.base.org');
  } catch {
    throw new Error('BASE_RPC_URL_TESTNET is invalid');
  }
  if (rpc.protocol !== 'https:') throw new Error('BASE_RPC_URL_TESTNET must use HTTPS');
  const mainSecrets = [main.SESSION_SECRET, main.ADS_REPORT_FINGERPRINT_SECRET];
  const sessionSecret = secret(previous.SESSION_SECRET, mainSecrets);
  const reportSecret = secret(previous.ADS_REPORT_FINGERPRINT_SECRET, [
    ...mainSecrets,
    sessionSecret,
  ]);
  const env = {
    NODE_ENV: 'development',
    PRECOMMUNITY_NETWORK: 'base-sepolia',
    NEXT_PUBLIC_PRECOMMUNITY_NETWORK: 'base-sepolia',
    DATABASE_URL: database.toString(),
    DATABASE_URL_TESTNET: database.toString(),
    REDIS_URL: redis.toString(),
    REDIS_URL_TESTNET: redis.toString(),
    ESCROW_ADDRESS_TESTNET: escrow,
    ESCROW_DEPLOYMENT_BLOCK_TESTNET: main.ESCROW_DEPLOYMENT_BLOCK_TESTNET,
    PRE_ADDRESS_TESTNET: pre,
    USDC_ADDRESS_TESTNET: address(main.USDC_ADDRESS_TESTNET, 'USDC_ADDRESS_TESTNET'),
    INITIAL_OWNER_ADDRESS_TESTNET: address(
      main.INITIAL_OWNER_ADDRESS_TESTNET,
      'INITIAL_OWNER_ADDRESS_TESTNET',
    ),
    TREASURY_ADDRESS_TESTNET: address(main.TREASURY_ADDRESS_TESTNET, 'TREASURY_ADDRESS_TESTNET'),
    CHAIN_CONFIRMATIONS_TESTNET: '12',
    SAFE_ADDRESS_TESTNET: safe,
    BASE_RPC_URL_TESTNET: rpc.toString(),
    NEXT_PUBLIC_BASE_RPC_URL_TESTNET: 'https://sepolia.base.org',
    ADS_CONTRACT_ADDRESS: '',
    ADS_CONTRACT_DEPLOYMENT_BLOCK: '',
    ADS_CONTRACT_ADDRESS_TESTNET: market,
    ADS_CONTRACT_DEPLOYMENT_BLOCK_TESTNET: marketBlock,
    KEYWORD_MARKET_DEPLOYMENT_NAME_TESTNET: deploymentName,
    ADS_OPERATOR_PRIVATE_KEY: '',
    HOST: '127.0.0.1',
    PORT: '4012',
    WEB_ORIGIN: 'http://127.0.0.1:3012',
    SIWE_DOMAIN: '127.0.0.1:3012',
    SIWE_URI: 'http://127.0.0.1:3012',
    INTERNAL_API_URL: 'http://127.0.0.1:4012',
    NEXT_PUBLIC_API_URL: '/api',
    NEXT_DIST_DIR: '.next-rehearsal',
    NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: main.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || '',
    SESSION_SECRET: sessionSecret,
    ADS_REPORT_FINGERPRINT_SECRET: reportSecret,
    COMMUNITY_MIN_PRE: '1',
    IPFS_GATEWAY_URL: 'https://ipfs.io/ipfs/',
    IPFS_TIMEOUT_MS: '5000',
  };
  return { env, pendingDeployment: manifest === null };
}

async function optionalFile(filename) {
  try {
    return await readFile(filename, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function main() {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const destination = path.join(root, '.env.keyword-rehearsal');
  const previousText = await optionalFile(destination);
  const previous = previousText === null ? {} : parseEnv(previousText);
  const deploymentName = selectKeywordMarketDeploymentName(process.argv.slice(2), previous);
  const manifestText = await optionalFile(
    path.resolve(root, '../escrow/.deployments', keywordMarketManifestName(deploymentName)),
  );
  const profile = buildKeywordRehearsalProfile(
    parseEnv(await readFile(path.join(root, '.env'), 'utf8')),
    previous,
    manifestText === null ? null : JSON.parse(manifestText),
    deploymentName,
  );
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    await writeFile(
      temporary,
      Object.entries(profile.env)
        .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
        .join('\n') + '\n',
      { mode: 0o600, flag: 'wx' },
    );
    await chmod(temporary, 0o600);
    await rename(temporary, destination);
  } finally {
    await unlink(temporary).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
  process.stdout.write(
    `Prepared ${destination}; Base Sepolia, schema ${REHEARSAL_SCHEMA}, isolated Redis 6382/DB 2, API 4012 and web 3012.\n`,
  );
  if (profile.pendingDeployment)
    process.stdout.write(
      'Keyword Market deployment is pending; contract settings remain empty. Run preparation again after the confirmed deployment.\n',
    );
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
