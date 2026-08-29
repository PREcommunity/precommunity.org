import { describe, expect, it } from 'vitest';
import {
  requireMatchingDeployment,
  requireMatchingTransactionDeployment,
  requireSuccessfulReceipt,
} from './transactions';

const deployment = {
  chainId: 84532,
  escrowAddress: '0x04a8CeABccE6bC13d3Cc89392D9AE39b43bD2a4D',
  networkName: 'Base Sepolia',
};

describe('transaction receipt validation', () => {
  it('accepts a successful receipt', () => {
    const receipt = { status: 'success' as const, transactionHash: '0x01' };
    expect(requireSuccessfulReceipt(receipt)).toBe(receipt);
  });

  it('rejects a reverted receipt', () => {
    expect(() => requireSuccessfulReceipt({ status: 'reverted' }, 'Contribution')).toThrow(
      'Contribution reverted on-chain',
    );
  });
});

describe('transaction deployment validation', () => {
  it('accepts an API response bound to the active chain and escrow', () => {
    expect(() => requireMatchingDeployment(deployment, deployment)).not.toThrow();
    expect(() =>
      requireMatchingTransactionDeployment(
        { chainId: deployment.chainId, to: deployment.escrowAddress },
        deployment,
      ),
    ).not.toThrow();
  });

  it('rejects a response prepared for another chain', () => {
    expect(() => requireMatchingDeployment({ ...deployment, chainId: 8453 }, deployment)).toThrow(
      'prepared this operation for chain 8453',
    );
  });

  it('rejects a response prepared for another escrow on the same chain', () => {
    expect(() =>
      requireMatchingTransactionDeployment(
        { chainId: deployment.chainId, to: '0x1111111111111111111111111111111111111111' },
        deployment,
      ),
    ).toThrow('different escrow deployments');
  });
});
