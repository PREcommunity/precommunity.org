export interface DeploymentManifest {
  schema: 'precommunity.deployment.v3';
  network: DeploymentNetwork;
  networkName: 'Base' | 'Base Sepolia';
  chainId: 8453 | 84532;
  safeNetworkPrefix: 'base' | 'basesep';
  explorerUrl: string;
  defaultRpcUrl: string;
  escrowAddress: `0x${string}`;
  deploymentBlock: string;
  preAddress: `0x${string}`;
  usdcAddress: `0x${string}`;
  owner: `0x${string}`;
  treasury: `0x${string}`;
  confirmations: number;
}

export type DeploymentNetwork = 'base' | 'base-sepolia';

export type DeploymentOverrides = Partial<
  Pick<
    DeploymentManifest,
    | 'escrowAddress'
    | 'deploymentBlock'
    | 'preAddress'
    | 'usdcAddress'
    | 'owner'
    | 'treasury'
    | 'confirmations'
  >
>;

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;
export const BASE_SEPOLIA_PRE_ADDRESS = '0x5471386EA2022e724A234A7690E338aA0A6689aD' as const;
export const BASE_SEPOLIA_USDC_ADDRESS = '0xdeBe6c9F496Bb7cca66727E9B8CB5B49f631058D' as const;

/** Base Sepolia stays disabled until the reviewed V1 `escrow` release is deployed. */
export const BASE_SEPOLIA_DEPLOYMENT: DeploymentManifest = Object.freeze({
  schema: 'precommunity.deployment.v3',
  network: 'base-sepolia',
  networkName: 'Base Sepolia',
  chainId: 84532,
  safeNetworkPrefix: 'basesep',
  explorerUrl: 'https://sepolia.basescan.org',
  defaultRpcUrl: 'https://sepolia.base.org',
  escrowAddress: ZERO_ADDRESS,
  deploymentBlock: '0',
  preAddress: BASE_SEPOLIA_PRE_ADDRESS,
  usdcAddress: BASE_SEPOLIA_USDC_ADDRESS,
  owner: ZERO_ADDRESS,
  treasury: ZERO_ADDRESS,
  confirmations: 6,
});

/** Base production values are supplied by the production deployment environment. */
export const BASE_MAINNET_DEPLOYMENT: DeploymentManifest = Object.freeze({
  schema: 'precommunity.deployment.v3',
  network: 'base',
  networkName: 'Base',
  chainId: 8453,
  safeNetworkPrefix: 'base',
  explorerUrl: 'https://basescan.org',
  defaultRpcUrl: 'https://mainnet.base.org',
  escrowAddress: ZERO_ADDRESS,
  deploymentBlock: '0',
  preAddress: ZERO_ADDRESS,
  usdcAddress: ZERO_ADDRESS,
  owner: ZERO_ADDRESS,
  treasury: ZERO_ADDRESS,
  confirmations: 12,
});

export function deploymentForNetwork(
  network: DeploymentNetwork,
  overrides: DeploymentOverrides = {},
): DeploymentManifest {
  const canonical = network === 'base' ? BASE_MAINNET_DEPLOYMENT : BASE_SEPOLIA_DEPLOYMENT;
  return Object.freeze({ ...canonical, ...withoutUndefined(overrides) });
}

export function isDeploymentConfigured(
  manifest: DeploymentManifest = BASE_SEPOLIA_DEPLOYMENT,
): boolean {
  return (
    manifest.deploymentBlock !== '0' &&
    [
      manifest.escrowAddress,
      manifest.preAddress,
      manifest.usdcAddress,
      manifest.owner,
      manifest.treasury,
    ].every((address) => address !== ZERO_ADDRESS)
  );
}

export function deploymentStateKey(manifest: DeploymentManifest = BASE_SEPOLIA_DEPLOYMENT): string {
  return `precommunity:escrow:${manifest.chainId}:${manifest.escrowAddress.toLowerCase()}`;
}

export function safeWalletQueueUrl(safeAddress: string, manifest: DeploymentManifest): string {
  const safe = `${manifest.safeNetworkPrefix}:${safeAddress}`;
  return `https://app.safe.global/transactions/queue?safe=${encodeURIComponent(safe)}`;
}

export function explorerTransactionUrl(hash: string, manifest: DeploymentManifest): string {
  return `${manifest.explorerUrl}/tx/${hash}`;
}

function withoutUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, Exclude<unknown, undefined>] =>
      Boolean(entry[1] !== undefined),
    ),
  ) as Partial<T>;
}
