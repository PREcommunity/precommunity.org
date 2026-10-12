import { deploymentForNetwork, isDeploymentConfigured } from './deployment';
import { base, baseSepolia } from 'viem/chains';
import { z } from 'zod';

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
// Keystore passwords are exact bytes, including leading and trailing whitespace.
const optionalPassword = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().optional(),
);
function decodeOperatorPassword(encoded: string | undefined) {
  if (!encoded || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded))
    return undefined;
  const decoded = Buffer.from(encoded, 'base64').toString('utf8');
  return Buffer.from(decoded).toString('base64') === encoded ? decoded : undefined;
}

export const serverConfigSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    REDIS_URL: z.string().url().default('redis://127.0.0.1:6379'),
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
    COINGECKO_API_KEY: optionalSecret,
    ADS_OPERATOR_KEYSTORE_PATH: optionalSecret,
    ADS_OPERATOR_KEYSTORE_PASSWORD: optionalPassword,
    ADS_OPERATOR_KEYSTORE_PASSWORD_BASE64: optionalPassword,
    ADS_OPERATOR_KEYSTORE_PATH_TESTNET: optionalSecret,
    ADS_OPERATOR_KEYSTORE_PASSWORD_TESTNET: optionalPassword,
    ADS_OPERATOR_KEYSTORE_PASSWORD_BASE64_TESTNET: optionalPassword,
    ADS_PRICE_UPDATER_KEYSTORE_PATH: optionalSecret,
    ADS_PRICE_UPDATER_KEYSTORE_PASSWORD: optionalPassword,
    ADS_PRICE_UPDATER_KEYSTORE_PASSWORD_BASE64: optionalPassword,
    ADS_PRICE_UPDATER_KEYSTORE_PATH_TESTNET: optionalSecret,
    ADS_PRICE_UPDATER_KEYSTORE_PASSWORD_TESTNET: optionalPassword,
    ADS_PRICE_UPDATER_KEYSTORE_PASSWORD_BASE64_TESTNET: optionalPassword,
    SAFE_TRANSACTION_SERVICE_URL: optionalUrl,
    SAFE_TRANSACTION_SERVICE_URL_TESTNET: optionalUrl,
    IPFS_GATEWAY_URL: z.string().url().default('https://ipfs.io/ipfs/'),
    IPFS_TIMEOUT_MS: z.coerce.number().int().positive().max(30_000).default(5_000),
  })
  .superRefine((value, context) => {
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
  });

type ServerRuntime = z.infer<typeof serverConfigSchema>;

export function resolveServerConfig<T extends ServerRuntime>(runtime: T) {
  const isTestnet = runtime.PRECOMMUNITY_NETWORK === 'base-sepolia';
  const deploymentOverrides = isTestnet
    ? {
        escrowAddress: runtime.ESCROW_ADDRESS_TESTNET as `0x${string}` | undefined,
        deploymentBlock: runtime.ESCROW_DEPLOYMENT_BLOCK_TESTNET,
        preAddress: runtime.PRE_ADDRESS_TESTNET as `0x${string}` | undefined,
        usdcAddress: runtime.USDC_ADDRESS_TESTNET as `0x${string}` | undefined,
        owner: runtime.INITIAL_OWNER_ADDRESS_TESTNET as `0x${string}` | undefined,
        treasury: runtime.TREASURY_ADDRESS_TESTNET as `0x${string}` | undefined,
        confirmations: runtime.CHAIN_CONFIRMATIONS_TESTNET,
      }
    : {
        escrowAddress: runtime.PUBLIC_ESCROW_ADDRESS as `0x${string}` | undefined,
        deploymentBlock: runtime.PUBLIC_ESCROW_DEPLOYMENT_BLOCK,
        preAddress: runtime.PUBLIC_PRE_ADDRESS as `0x${string}` | undefined,
        usdcAddress: runtime.PUBLIC_USDC_ADDRESS as `0x${string}` | undefined,
        owner: runtime.PUBLIC_INITIAL_OWNER_ADDRESS as `0x${string}` | undefined,
        treasury: runtime.PUBLIC_TREASURY_ADDRESS as `0x${string}` | undefined,
        confirmations: runtime.PUBLIC_CHAIN_CONFIRMATIONS,
      };
  const deployment = deploymentForNetwork(runtime.PRECOMMUNITY_NETWORK, deploymentOverrides);

  const hasDeploymentOverride = Object.values(deploymentOverrides).some(
    (value) => value !== undefined,
  );

  if (
    (runtime.NODE_ENV === 'production' || hasDeploymentOverride) &&
    !isDeploymentConfigured(deployment)
  ) {
    throw new Error(
      'The escrow deployment requires complete contract, deployment block, token, owner and treasury settings',
    );
  }

  const operatorPassword = isTestnet
    ? runtime.ADS_OPERATOR_KEYSTORE_PASSWORD_TESTNET
    : runtime.ADS_OPERATOR_KEYSTORE_PASSWORD;
  const encodedOperatorPassword = isTestnet
    ? runtime.ADS_OPERATOR_KEYSTORE_PASSWORD_BASE64_TESTNET
    : runtime.ADS_OPERATOR_KEYSTORE_PASSWORD_BASE64;

  return {
    ...runtime,
    BASE_RPC_URL:
      (isTestnet ? runtime.BASE_RPC_URL_TESTNET : runtime.BASE_RPC_URL) ?? deployment.defaultRpcUrl,
    REDIS_URL: (isTestnet ? runtime.REDIS_URL_TESTNET : undefined) ?? runtime.REDIS_URL,
    SAFE_ADDRESS: isTestnet ? runtime.SAFE_ADDRESS_TESTNET : runtime.SAFE_ADDRESS,
    SAFE_TRANSACTION_SERVICE_URL: isTestnet
      ? runtime.SAFE_TRANSACTION_SERVICE_URL_TESTNET
      : runtime.SAFE_TRANSACTION_SERVICE_URL,
    chain: deployment.network === 'base' ? base : baseSepolia,
    adsOperator: {
      keystorePath:
        (isTestnet
          ? runtime.ADS_OPERATOR_KEYSTORE_PATH_TESTNET
          : runtime.ADS_OPERATOR_KEYSTORE_PATH) ?? null,
      password: operatorPassword ?? decodeOperatorPassword(encodedOperatorPassword),
    },
    adsPriceUpdater: {
      keystorePath:
        (isTestnet
          ? runtime.ADS_PRICE_UPDATER_KEYSTORE_PATH_TESTNET
          : runtime.ADS_PRICE_UPDATER_KEYSTORE_PATH) ?? null,
      password:
        (isTestnet
          ? runtime.ADS_PRICE_UPDATER_KEYSTORE_PASSWORD_TESTNET
          : runtime.ADS_PRICE_UPDATER_KEYSTORE_PASSWORD) ??
        decodeOperatorPassword(
          isTestnet
            ? runtime.ADS_PRICE_UPDATER_KEYSTORE_PASSWORD_BASE64_TESTNET
            : runtime.ADS_PRICE_UPDATER_KEYSTORE_PASSWORD_BASE64,
        ),
    },
    deployment,
    adsContract: {
      address:
        (isTestnet
          ? runtime.ADS_CONTRACT_ADDRESS_TESTNET
          : runtime.ADS_CONTRACT_ADDRESS
        )?.toLowerCase() ?? null,
      deploymentBlock:
        (isTestnet
          ? runtime.ADS_CONTRACT_DEPLOYMENT_BLOCK_TESTNET
          : runtime.ADS_CONTRACT_DEPLOYMENT_BLOCK) ?? null,
      status: 'AWAITING_CONTRACT' as const,
    },
  } as const;
}
