import { describe, expect, it, vi } from 'vitest';
import { recoveredSafeTransaction, resolveSafeTransaction } from './safe-proposals';

const proposal = { safeTxHash: '0xABC', safeNonce: '4' };
const safeAddress = '0x1111111111111111111111111111111111111111';
const pending = { safeTxHash: '0xabc', nonce: 4, isExecuted: false };
const executed = { ...pending, isExecuted: true };
const replaced = { ...executed, safeTxHash: '0xdef' };

describe('Safe transaction lookup', () => {
  it('keeps the original transaction while the nonce is current', async () => {
    const service = {
      getTransaction: vi.fn().mockResolvedValue(pending),
      getMultisigTransactions: vi.fn(),
    };
    expect(await resolveSafeTransaction(service, safeAddress, proposal, 4n)).toEqual({
      transaction: pending,
      nonceWasReplaced: false,
    });
    expect(service.getMultisigTransactions).not.toHaveBeenCalled();
  });
  it.each([
    [executed, false],
    [replaced, true],
  ] as const)('distinguishes own execution from a replacement', async (found, nonceWasReplaced) => {
    const service = {
      getTransaction: vi.fn().mockResolvedValue(pending),
      getMultisigTransactions: vi.fn().mockResolvedValue({ results: [found] }),
    };
    expect(await resolveSafeTransaction(service, safeAddress, proposal, 5n)).toEqual({
      transaction: nonceWasReplaced ? pending : executed,
      nonceWasReplaced,
    });
  });
  it('keeps 404 and service failures available to caller-specific recovery', async () => {
    const error = { statusCode: 404 };
    const service = {
      getTransaction: vi.fn().mockRejectedValue(error),
      getMultisigTransactions: vi.fn(),
    };
    await expect(resolveSafeTransaction(service, safeAddress, proposal, 5n)).rejects.toBe(error);
  });
  it('does not mark replacement when the nonce lookup fails', async () => {
    const service = {
      getTransaction: vi.fn().mockResolvedValue(pending),
      getMultisigTransactions: vi.fn().mockRejectedValue(new Error('unavailable')),
    };
    expect(await resolveSafeTransaction(service, safeAddress, proposal, 5n)).toEqual({
      transaction: pending,
      nonceWasReplaced: false,
    });
  });
  it('prefers own execution and excludes pending proposals displaced by execution', () => {
    expect(recoveredSafeTransaction([pending, replaced] as never, proposal.safeTxHash)).toEqual({
      ownTransaction: undefined,
      nonceWasReplaced: true,
    });
    expect(
      recoveredSafeTransaction([pending, replaced, executed] as never, proposal.safeTxHash),
    ).toEqual({ ownTransaction: executed, nonceWasReplaced: false });
    expect(recoveredSafeTransaction([pending] as never, proposal.safeTxHash)).toEqual({
      ownTransaction: pending,
      nonceWasReplaced: false,
    });
    expect(recoveredSafeTransaction([], proposal.safeTxHash)).toEqual({
      ownTransaction: undefined,
      nonceWasReplaced: false,
    });
  });
});
