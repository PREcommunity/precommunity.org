import { getAddress, isAddressEqual } from 'viem';

export interface TransactionReceiptStatus {
  status: 'success' | 'reverted';
}

export interface DeploymentIdentity {
  chainId: number;
  escrowAddress: string;
}

export function requireMatchingDeployment(
  received: DeploymentIdentity,
  expected: DeploymentIdentity & { networkName: string },
): void {
  if (received.chainId !== expected.chainId) {
    throw new Error(
      `The API prepared this operation for chain ${received.chainId}, but this app uses ${expected.networkName} (${expected.chainId}). Refresh after aligning the deployment configuration.`,
    );
  }
  if (!isAddressEqual(getAddress(received.escrowAddress), getAddress(expected.escrowAddress))) {
    throw new Error(
      'The API and this app use different escrow deployments. Refresh after aligning the deployment configuration.',
    );
  }
}

export function requireMatchingTransactionDeployment(
  request: { chainId: number; to: string },
  expected: DeploymentIdentity & { networkName: string },
): void {
  requireMatchingDeployment({ chainId: request.chainId, escrowAddress: request.to }, expected);
}

export function requireSuccessfulReceipt<T extends TransactionReceiptStatus>(
  receipt: T,
  label = 'Transaction',
): T {
  if (receipt.status !== 'success') throw new Error(`${label} reverted on-chain`);
  return receipt;
}
