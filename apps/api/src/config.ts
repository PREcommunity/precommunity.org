import { z } from 'zod';
import { deploymentForNetwork, isDeploymentConfigured } from '@precommunity/shared';
import { base, baseSepolia } from 'viem/chains';

const developmentSessionSecret = 'development-only-session-secret-change-me';
const exampleSessionSecret = 'replace-with-at-least-32-random-characters';
const developmentAdsReportSecret = 'development-only-ads-report-secret';
const exampleAdsReportSecret = 'replace-with-an-independent-ads-report-secret';
const emptyToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;
const optionalAddress = z.preprocess(
  emptyToUndefined,
  z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .optional(),
);
const optionalUrl = z.preprocess(emptyToUndefined, z.string().url().optional());
const optionalBlock = z.preprocess(emptyToUndefined, z.string().regex(/^\d+$/).optional());
const optionalConfirmations = z.preprocess(
  emptyToUndefined,
  z.coerce.number().int().positive().max(1_000).optional(),
);
const optionalSecret = z.preprocess(emptyToUndefined, z.string().trim().min(1).optional());
const runtimeConfig = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().min(1).default('127.0.0.1'),
    PORT: z.coerce.number().int().positive().default(4000),
    REDIS_URL: z.string().url().default('redis://127.0.0.1:6379'),
    WEB_ORIGIN: z.string().url().default('http://localhost:3011'),
    SIWE_DOMAIN: z.string().default('localhost:3011'),
    SIWE_URI: z.string().url().default('http://localhost:3011'),
    SESSION_SECRET: z.string().min(32).default(developmentSessionSecret),
    ADS_REPORT_FINGERPRINT_SECRET: z.string().min(32).default(developmentAdsReportSecret),
    PRECOMMUNITY_NETWORK: z.enum(['base', 'base-sepolia']).default('base-sepolia'),
    BASE_RPC_URL: optionalUrl,
    BASE_RPC_URL_TESTNET: optionalUrl,
    REDIS_URL_TESTNET: optionalUrl,
    PUBLIC_ESCROW_ADDRESS: optionalAddress,
    PUBLIC_ESCROW_DEPLOYMENT_BLOCK: optionalBlock,
    PUBLIC_PRE_ADDRESS: optionalAddress,
    PUBLIC_USDC_ADDRESS: optionalAddress,
    ESCROW_ADDRESS_TESTNET: optionalAddress,
    ESCROW_DEPLOYMENT_BLOCK_TESTNET: optionalBlock,
    PRE_ADDRESS_TESTNET: optionalAddress,
    USDC_ADDRESS_TESTNET: optionalAddress,
    INITIAL_OWNER_ADDRESS_TESTNET: optionalAddress,
    TREASURY_ADDRESS_TESTNET: optionalAddress,
    CHAIN_CONFIRMATIONS_TESTNET: optionalConfirmations,
    PUBLIC_INITIAL_OWNER_ADDRESS: optionalAddress,
    PUBLIC_TREASURY_ADDRESS: optionalAddress,
    PUBLIC_CHAIN_CONFIRMATIONS: optionalConfirmations,
    ADS_CONTRACT_ADDRESS: optionalAddress,
    ADS_CONTRACT_DEPLOYMENT_BLOCK: optionalBlock,
    ADS_CONTRACT_ADDRESS_TESTNET: optionalAddress,
    ADS_CONTRACT_DEPLOYMENT_BLOCK_TESTNET: optionalBlock,
    SAFE_ADDRESS: optionalAddress,
    SAFE_ADDRESS_TESTNET: optionalAddress,
    SAFE_TRANSACTION_SERVICE_API_KEY: optionalSecret,
    SAFE_TRANSACTION_SERVICE_URL: optionalUrl,
    SAFE_TRANSACTION_SERVICE_URL_TESTNET: optionalUrl,
    IPFS_GATEWAY_URL: z.string().url().default('https://ipfs.io/ipfs/'),
    IPFS_TIMEOUT_MS: z.coerce.number().int().positive().max(30_000).default(5_000),
    COMMUNITY_MIN_PRE: z
      .string()
      .regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/)
      .default('1'),
  })
  .superRefine((value, context) => {
    if (
      value.NODE_ENV === 'production' &&
      (value.SESSION_SECRET === developmentSessionSecret ||
        value.SESSION_SECRET === exampleSessionSecret)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['SESSION_SECRET'],
        message: 'Production requires an explicit session secret',
      });
    }
    if (
      value.NODE_ENV === 'production' &&
      (value.ADS_REPORT_FINGERPRINT_SECRET === developmentAdsReportSecret ||
        value.ADS_REPORT_FINGERPRINT_SECRET === exampleAdsReportSecret)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['ADS_REPORT_FINGERPRINT_SECRET'],
        message: 'Production requires an independent PRE Keyword Market report fingerprint secret',
      });
    }
    if (Boolean(value.ADS_CONTRACT_ADDRESS) !== Boolean(value.ADS_CONTRACT_DEPLOYMENT_BLOCK)) {
      context.addIssue({
        code: 'custom',
        path: ['ADS_CONTRACT_ADDRESS'],
        message:
          'PRE Keyword Market contract address and deployment block must be configured together',
      });
    }
    if (
      Boolean(value.ADS_CONTRACT_ADDRESS_TESTNET) !==
      Boolean(value.ADS_CONTRACT_DEPLOYMENT_BLOCK_TESTNET)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['ADS_CONTRACT_ADDRESS_TESTNET'],
        message:
          'Testnet PRE Keyword Market contract address and deployment block must be configured together',
      });
    }
  })
  .parse(process.env);

const isTestnet = runtimeConfig.PRECOMMUNITY_NETWORK === 'base-sepolia';
const deploymentOverrides = isTestnet
  ? {
      escrowAddress: runtimeConfig.ESCROW_ADDRESS_TESTNET as `0x${string}` | undefined,
      deploymentBlock: runtimeConfig.ESCROW_DEPLOYMENT_BLOCK_TESTNET,
      preAddress: runtimeConfig.PRE_ADDRESS_TESTNET as `0x${string}` | undefined,
      usdcAddress: runtimeConfig.USDC_ADDRESS_TESTNET as `0x${string}` | undefined,
      owner: runtimeConfig.INITIAL_OWNER_ADDRESS_TESTNET as `0x${string}` | undefined,
      treasury: runtimeConfig.TREASURY_ADDRESS_TESTNET as `0x${string}` | undefined,
      confirmations: runtimeConfig.CHAIN_CONFIRMATIONS_TESTNET,
    }
  : {
      escrowAddress: runtimeConfig.PUBLIC_ESCROW_ADDRESS as `0x${string}` | undefined,
      deploymentBlock: runtimeConfig.PUBLIC_ESCROW_DEPLOYMENT_BLOCK,
      preAddress: runtimeConfig.PUBLIC_PRE_ADDRESS as `0x${string}` | undefined,
      usdcAddress: runtimeConfig.PUBLIC_USDC_ADDRESS as `0x${string}` | undefined,
      owner: runtimeConfig.PUBLIC_INITIAL_OWNER_ADDRESS as `0x${string}` | undefined,
      treasury: runtimeConfig.PUBLIC_TREASURY_ADDRESS as `0x${string}` | undefined,
      confirmations: runtimeConfig.PUBLIC_CHAIN_CONFIRMATIONS,
    };
const deployment = deploymentForNetwork(runtimeConfig.PRECOMMUNITY_NETWORK, deploymentOverrides);

const hasDeploymentOverride = Object.values(deploymentOverrides).some(
  (value) => value !== undefined,
);

if (
  (runtimeConfig.NODE_ENV === 'production' || hasDeploymentOverride) &&
  !isDeploymentConfigured(deployment)
) {
  throw new Error(
    'The escrow deployment requires complete contract, deployment block, token, owner and treasury settings',
  );
}

export const config = {
  ...runtimeConfig,
  BASE_CHAIN_ID: deployment.chainId,
  BASE_RPC_URL:
    (isTestnet ? runtimeConfig.BASE_RPC_URL_TESTNET : runtimeConfig.BASE_RPC_URL) ??
    deployment.defaultRpcUrl,
  REDIS_URL: (isTestnet ? runtimeConfig.REDIS_URL_TESTNET : undefined) ?? runtimeConfig.REDIS_URL,
  SAFE_ADDRESS: isTestnet ? runtimeConfig.SAFE_ADDRESS_TESTNET : runtimeConfig.SAFE_ADDRESS,
  SAFE_TRANSACTION_SERVICE_URL: isTestnet
    ? runtimeConfig.SAFE_TRANSACTION_SERVICE_URL_TESTNET
    : runtimeConfig.SAFE_TRANSACTION_SERVICE_URL,
  chain: deployment.network === 'base' ? base : baseSepolia,
  deployment,
  allowedWebOrigins: [new URL(runtimeConfig.WEB_ORIGIN).origin],
  adsContract: {
    address:
      (isTestnet
        ? runtimeConfig.ADS_CONTRACT_ADDRESS_TESTNET
        : runtimeConfig.ADS_CONTRACT_ADDRESS
      )?.toLowerCase() ?? null,
    deploymentBlock:
      (isTestnet
        ? runtimeConfig.ADS_CONTRACT_DEPLOYMENT_BLOCK_TESTNET
        : runtimeConfig.ADS_CONTRACT_DEPLOYMENT_BLOCK) ?? null,
    status: 'AWAITING_CONTRACT' as const,
  },
} as const;
