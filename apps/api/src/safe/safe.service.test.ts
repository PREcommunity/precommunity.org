import { ForbiddenException } from '@nestjs/common';
import { OperationType, type SafeTransactionData } from '@safe-global/types-kit';
import { getAddress } from 'viem';
import { describe, expect, it, vi } from 'vitest';
import { config } from '../config';
import { SafeService } from './safe.service';

const zeroAddress = '0x0000000000000000000000000000000000000000';
const expected = {
  to: '0x0000000000000000000000000000000000000001',
  value: '0',
  data: '0x1234',
  nonce: 7,
};

function transaction(overrides: Partial<SafeTransactionData> = {}): SafeTransactionData {
  return {
    ...expected,
    operation: OperationType.Call,
    safeTxGas: '0',
    baseGas: '0',
    gasPrice: '0',
    gasToken: zeroAddress,
    refundReceiver: zeroAddress,
    ...overrides,
  };
}

describe('SafeService payout validation', () => {
  const service = new SafeService();

  it('accepts only the exact zero-gas payout intent', () => {
    expect(() => service.validateTransactionData(transaction(), expected)).not.toThrow();
  });

  it.each([
    { to: '0x0000000000000000000000000000000000000002' },
    { value: '1' },
    { data: '0xabcd' },
    { nonce: 8 },
    { operation: OperationType.DelegateCall },
    { safeTxGas: '1' },
    { gasToken: '0x0000000000000000000000000000000000000002' },
  ] satisfies Array<Partial<SafeTransactionData>>)(
    'rejects a changed Safe transaction field: %o',
    (override) => {
      expect(() => service.validateTransactionData(transaction(override), expected)).toThrow(
        ForbiddenException,
      );
    },
  );
});

describe('SafeService MultiSend validation', () => {
  const service = new SafeService();
  const expectedMultiSend = transaction({
    to: '0x0000000000000000000000000000000000000003',
    data: '0xabcdef',
    operation: OperationType.DelegateCall,
    nonce: 12,
  });

  it('accepts an exact reconstructed MultiSend transaction', () => {
    expect(() =>
      service.validateExactTransactionData(expectedMultiSend, expectedMultiSend),
    ).not.toThrow();
  });

  it.each([
    { to: '0x0000000000000000000000000000000000000004' },
    { data: '0xabcd' },
    { nonce: 13 },
    { operation: OperationType.Call },
    { value: '1' },
    { safeTxGas: '1' },
  ] satisfies Array<Partial<SafeTransactionData>>)(
    'rejects a changed MultiSend field: %o',
    (override) => {
      expect(() =>
        service.validateExactTransactionData(
          { ...expectedMultiSend, ...override },
          expectedMultiSend,
          'goal manager synchronization',
        ),
      ).toThrow(ForbiddenException);
    },
  );
});

describe('SafeService ownership acceptance', () => {
  it('preflights a manual acceptOwnership request without Transaction Service', async () => {
    const service = new SafeService();
    const safeAddress = getAddress('0x2222222222222222222222222222222222222222');
    const simulateContract = vi.fn().mockResolvedValue({});
    const apiKit = vi.fn(() => {
      throw new Error('Transaction Service must not be called');
    });
    Object.defineProperty(service, 'runtimeInfo', {
      configurable: true,
      value: vi.fn().mockResolvedValue({
        address: safeAddress,
        owners: [getAddress('0x1111111111111111111111111111111111111111')],
        threshold: 2,
        nonce: 7,
        escrowOwner: getAddress('0x1111111111111111111111111111111111111111'),
        isEscrowOwner: false,
        pendingOwner: safeAddress,
        isPendingEscrowOwner: true,
        queueUrl: 'https://app.safe.global/transactions/queue?safe=basesep:test',
      }),
    });
    Object.defineProperty(service, 'publicClient', {
      configurable: true,
      value: { simulateContract },
    });
    Object.defineProperty(service, 'apiKit', { configurable: true, value: apiKit });

    await expect(
      service.manualOwnershipAcceptanceRequest('0x1111111111111111111111111111111111111111'),
    ).resolves.toMatchObject({
      safeAddress,
      threshold: 2,
      transactionRequest: {
        chainId: config.deployment.chainId,
        to: getAddress(config.deployment.escrowAddress),
        value: '0',
        data: '0x79ba5097',
      },
    });
    expect(simulateContract).toHaveBeenCalledOnce();
    expect(apiKit).not.toHaveBeenCalled();
  });

  it('finds only the exact pending acceptOwnership transaction', async () => {
    const service = new SafeService();
    const safeAddress = getAddress('0x2222222222222222222222222222222222222222');
    const escrowAddress = getAddress(config.deployment.escrowAddress);
    const getPendingTransactions = async () => ({
      results: [
        {
          to: escrowAddress,
          value: '0',
          data: '0x1234',
          operation: OperationType.Call,
          nonce: '7',
          safeTxHash: `0x${'11'.repeat(32)}`,
          isExecuted: false,
          confirmationsRequired: 2,
          confirmations: [{}],
        },
        {
          to: escrowAddress,
          value: '0',
          data: '0x79ba5097',
          operation: OperationType.Call,
          nonce: '8',
          safeTxHash: `0x${'22'.repeat(32)}`,
          isExecuted: false,
          confirmationsRequired: 2,
          confirmations: [{}, {}],
        },
      ],
    });
    Object.defineProperty(service, 'apiKit', {
      configurable: true,
      value: () => ({ getPendingTransactions }),
    });
    Object.defineProperty(service, 'isConfigured', {
      configurable: true,
      value: () => true,
    });

    await expect(
      service.ownershipAcceptanceStatus({
        address: safeAddress,
        owners: [],
        threshold: 2,
        nonce: 7,
        escrowOwner: getAddress('0x1111111111111111111111111111111111111111'),
        isEscrowOwner: false,
        pendingOwner: safeAddress,
        isPendingEscrowOwner: true,
        queueUrl: 'https://app.safe.global/transactions/queue?safe=basesep:test',
      }),
    ).resolves.toEqual({
      safeTxHash: `0x${'22'.repeat(32)}`,
      safeNonce: 8,
      confirmations: 2,
      threshold: 2,
      readyToExecute: true,
      queueUrl: 'https://app.safe.global/transactions/queue?safe=basesep:test',
    });
  });
});
