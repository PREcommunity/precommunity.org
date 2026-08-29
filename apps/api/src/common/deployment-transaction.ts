import type { Address, Hex } from 'viem';
import { config } from '../config';

export interface DeploymentTransactionRequest {
  chainId: number;
  to: Address;
  value: string;
  data: Hex;
}

export function deploymentTransactionRequest(
  request: Omit<DeploymentTransactionRequest, 'chainId'>,
): DeploymentTransactionRequest {
  return { chainId: config.deployment.chainId, ...request };
}
