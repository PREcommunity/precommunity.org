import { beforeEach, describe, expect, it, vi } from 'vitest';
import Safe from '@safe-global/protocol-kit';
import { OperationType } from '@safe-global/types-kit';
import { signSafeProposal } from './sign-safe-proposal';

vi.mock('@safe-global/protocol-kit', () => ({ default: { init: vi.fn() } }));
const signer = '0x1111111111111111111111111111111111111111';
const safeAddress = '0x2222222222222222222222222222222222222222';
const provider = { request: vi.fn() };
const transaction = { data: { nonce: 7 } };
const kit = { createTransaction: vi.fn(), getTransactionHash: vi.fn(), signHash: vi.fn() };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(Safe.init).mockResolvedValue(kit as never);
  kit.createTransaction.mockResolvedValue(transaction);
  kit.getTransactionHash.mockResolvedValue('0xabc');
  kit.signHash.mockResolvedValue({ data: '0xdef' });
});
describe('Safe signing', () => {
  it.each([1, 2])('preserves the exact %i contract call(s) and nonce', async (count) => {
    const calls = Array.from({ length: count }, () => ({
      to: signer as `0x${string}`,
      data: '0x1234' as const,
      value: '0',
      operation: OperationType.Call,
    }));
    expect(await signSafeProposal(provider, signer, safeAddress, 7, calls)).toEqual({
      transaction: transaction.data,
      safeTxHash: '0xabc',
      senderAddress: signer,
      senderSignature: '0xdef',
    });
    expect(Safe.init).toHaveBeenCalledWith({ provider, signer, safeAddress });
    expect(kit.createTransaction).toHaveBeenCalledWith({
      transactions: calls,
      options: { nonce: 7 },
    });
    expect(kit.getTransactionHash).toHaveBeenCalledWith(transaction);
    expect(kit.signHash).toHaveBeenCalledWith('0xabc');
  });
  it('rejects a missing provider before initializing Safe', async () => {
    await expect(signSafeProposal(undefined, signer, safeAddress, 0, [])).rejects.toThrow(
      'provider is unavailable',
    );
    expect(Safe.init).not.toHaveBeenCalled();
  });
  it('propagates wallet rejection without retrying', async () => {
    const error = new Error('User rejected');
    kit.signHash.mockRejectedValue(error);
    await expect(signSafeProposal(provider, signer, safeAddress, 0, [])).rejects.toBe(error);
    expect(kit.signHash).toHaveBeenCalledTimes(1);
  });
});
