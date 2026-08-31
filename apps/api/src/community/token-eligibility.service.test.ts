import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { TokenEligibilityService } from './token-eligibility.service';

describe('TokenEligibilityService', () => {
  it('caches current PRE balances briefly and enforces the configured threshold', async () => {
    const service = new TokenEligibilityService();
    const readContract = vi.fn().mockResolvedValue(1_000_000_000_000_000_000n);
    (service as unknown as { client: { readContract: typeof readContract } }).client = {
      readContract,
    };

    await expect(
      service.status('0x0000000000000000000000000000000000000001'),
    ).resolves.toMatchObject({ eligible: true });
    await expect(
      service.status('0x0000000000000000000000000000000000000001'),
    ).resolves.toMatchObject({ eligible: true });
    expect(readContract).toHaveBeenCalledTimes(1);
  });

  it('reads and permanently caches a historical snapshot balance', async () => {
    const service = new TokenEligibilityService();
    const readContract = vi.fn().mockResolvedValue(9n);
    (service as unknown as { client: { readContract: typeof readContract } }).client = {
      readContract,
    };
    const address = '0x0000000000000000000000000000000000000002';

    await service.snapshotBalance(address, 123n);
    await service.snapshotBalance(address, 123n);
    expect(readContract).toHaveBeenCalledTimes(1);
    expect(readContract).toHaveBeenCalledWith(expect.objectContaining({ blockNumber: 123n }));
  });

  it('rejects current participation below one PRE', async () => {
    const service = new TokenEligibilityService();
    const readContract = vi.fn().mockResolvedValue(999_999_999_999_999_999n);
    (service as unknown as { client: { readContract: typeof readContract } }).client = {
      readContract,
    };

    await expect(
      service.assertCurrent('0x0000000000000000000000000000000000000003'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows a zero threshold without calling the balance RPC', async () => {
    const service = new TokenEligibilityService();
    const readContract = vi.fn();
    (service as unknown as { client: { readContract: typeof readContract } }).client = {
      readContract,
    };

    await expect(
      service.assertCurrent('0x0000000000000000000000000000000000000003', 0n),
    ).resolves.toBe(0n);
    expect(readContract).not.toHaveBeenCalled();
  });

  it('rejects a wallet below one PRE at the snapshot', () => {
    const service = new TokenEligibilityService();
    expect(() => service.assertSnapshotEligible(999_999_999_999_999_999n)).toThrow(
      ForbiddenException,
    );
  });
});
