import {
  deploymentForNetwork,
  explorerTransactionUrl,
  isDeploymentConfigured,
  type DeploymentNetwork,
} from '@precommunity/shared';
import { base, baseSepolia } from 'wagmi/chains';

function publicAddress(value: string | undefined): `0x${string}` | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  if (!/^0x[a-fA-F0-9]{40}$/.test(normalized)) {
    throw new Error(`Invalid public deployment address: ${normalized}`);
  }
  return normalized as `0x${string}`;
}

function publicConfirmations(value: string | undefined) {
  if (!value?.trim()) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 1_000) {
    throw new Error('PUBLIC_CHAIN_CONFIRMATIONS must be an integer from 1 to 1000');
  }
  return parsed;
}

export function publicDeploymentNetwork(
  value: string | undefined,
  nodeEnv = process.env.NODE_ENV,
): DeploymentNetwork {
  const normalized = value?.trim();
  if (normalized === 'base' || normalized === 'base-sepolia') return normalized;
  if (!normalized && nodeEnv !== 'production') return 'base-sepolia';

  throw new Error(
    normalized
      ? `Unsupported NEXT_PUBLIC_PRECOMMUNITY_NETWORK: ${normalized}`
      : 'NEXT_PUBLIC_PRECOMMUNITY_NETWORK is required in production',
  );
}

export const activeNetwork = publicDeploymentNetwork(process.env.NEXT_PUBLIC_PRECOMMUNITY_NETWORK);

const isTestnet = activeNetwork === 'base-sepolia';
const deploymentOverrides = isTestnet
  ? {
      escrowAddress: publicAddress(process.env.ESCROW_ADDRESS_TESTNET),
      deploymentBlock: process.env.ESCROW_DEPLOYMENT_BLOCK_TESTNET?.trim() || undefined,
      preAddress: publicAddress(process.env.PRE_ADDRESS_TESTNET),
      usdcAddress: publicAddress(process.env.USDC_ADDRESS_TESTNET),
      owner: publicAddress(process.env.INITIAL_OWNER_ADDRESS_TESTNET),
      treasury: publicAddress(process.env.TREASURY_ADDRESS_TESTNET),
      confirmations: publicConfirmations(process.env.CHAIN_CONFIRMATIONS_TESTNET),
    }
  : {
      escrowAddress: publicAddress(process.env.PUBLIC_ESCROW_ADDRESS),
      deploymentBlock: process.env.PUBLIC_ESCROW_DEPLOYMENT_BLOCK?.trim() || undefined,
      preAddress: publicAddress(process.env.PUBLIC_PRE_ADDRESS),
      usdcAddress: publicAddress(process.env.PUBLIC_USDC_ADDRESS),
      owner: publicAddress(process.env.PUBLIC_INITIAL_OWNER_ADDRESS),
      treasury: publicAddress(process.env.PUBLIC_TREASURY_ADDRESS),
      confirmations: publicConfirmations(process.env.PUBLIC_CHAIN_CONFIRMATIONS),
    };

export const activeDeployment = deploymentForNetwork(activeNetwork, deploymentOverrides);

const hasPublicDeploymentOverride = Object.values(deploymentOverrides).some(
  (value) => value !== undefined,
);

if (
  (process.env.NODE_ENV === 'production' || hasPublicDeploymentOverride) &&
  !isDeploymentConfigured(activeDeployment)
) {
  throw new Error(
    'The escrow deployment requires complete contract, deployment block, token, owner and treasury settings',
  );
}

export const activeChain = activeNetwork === 'base' ? base : baseSepolia;
export const activeRpcUrl =
  (isTestnet
    ? process.env.NEXT_PUBLIC_BASE_RPC_URL_TESTNET?.trim()
    : process.env.NEXT_PUBLIC_BASE_RPC_URL?.trim()) || activeDeployment.defaultRpcUrl;

export function activeExplorerTransaction(hash: string) {
  return explorerTransactionUrl(hash, activeDeployment);
}

export function activeExplorerAddress(address: string) {
  return explorerAddressUrl(address, activeDeployment);
}

export function explorerAddressUrl(address: string, deployment = activeDeployment) {
  return `${deployment.explorerUrl}/address/${address}`;
}
