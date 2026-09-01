import { OperationType } from '@safe-global/types-kit';
import { describe, expect, it } from 'vitest';
import type { AdminManualSafeExport } from './admin-workspace-types';
import {
  safeTransactionBuilderArtifact,
  safeTransactionBuilderFile,
  serializeSafeTransactionBuilderFile,
} from './safe-transaction-builder';

const request: AdminManualSafeExport = {
  mode: 'MANUAL',
  name: 'Release payout',
  description: 'Release confirmed funds.',
  chainId: 84532,
  safeAddress: '0x2222222222222222222222222222222222222222',
  queueUrl: 'https://app.safe.global/transactions/queue?safe=basesep:test',
  transactionRequest: {
    chainId: 84532,
    to: '0x3333333333333333333333333333333333333333',
    value: '0',
    data: '0x1234',
  },
  transactions: [
    {
      chainId: 84532,
      to: '0x3333333333333333333333333333333333333333',
      value: '0',
      data: '0x1234',
      operation: OperationType.Call,
    },
  ],
};

describe('Safe Transaction Builder export', () => {
  it('serializes the official v1 raw transaction format exactly once', () => {
    const createdAt = 1_788_278_400_000;
    const file = safeTransactionBuilderFile(
      request,
      '0x1111111111111111111111111111111111111111',
      createdAt,
    );
    expect(file).toEqual({
      version: '1.0',
      chainId: '84532',
      createdAt,
      meta: {
        name: 'Release payout',
        description: 'Release confirmed funds.',
        createdFromSafeAddress: request.safeAddress,
        createdFromOwnerAddress: '0x1111111111111111111111111111111111111111',
      },
      transactions: [
        {
          to: request.transactionRequest.to,
          value: '0',
          data: '0x1234',
        },
      ],
    });
    expect(
      JSON.parse(
        serializeSafeTransactionBuilderFile(request, file.meta.createdFromOwnerAddress, createdAt),
      ),
    ).toEqual(file);
    const artifact = safeTransactionBuilderArtifact(
      request,
      file.meta.createdFromOwnerAddress,
      createdAt,
    );
    expect(artifact.json).toBe(
      serializeSafeTransactionBuilderFile(request, file.meta.createdFromOwnerAddress, createdAt),
    );
  });

  it('rejects a chain mismatch and DelegateCall', () => {
    expect(() =>
      safeTransactionBuilderFile(
        {
          ...request,
          transactions: [{ ...request.transactions[0]!, chainId: 8453 }],
        },
        '0x1111111111111111111111111111111111111111',
      ),
    ).toThrow('different chain');
    expect(() =>
      safeTransactionBuilderFile(
        {
          ...request,
          transactions: [{ ...request.transactions[0]!, operation: OperationType.DelegateCall }],
        },
        '0x1111111111111111111111111111111111111111',
      ),
    ).toThrow('DelegateCall');
  });
});
