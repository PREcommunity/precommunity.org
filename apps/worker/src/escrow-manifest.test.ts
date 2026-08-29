import { describe, expect, it, vi } from 'vitest';
import { config } from './config';
import { verifyEscrowManifest } from './escrow-manifest';

const zeroAddress = '0x0000000000000000000000000000000000000000';
const safeAddress = '0x0000000000000000000000000000000000000005';

function manifestClient(
  overrides: {
    settlementLimit?: bigint;
    scheduleVersion?: bigint;
    minFirstSettlementDelay?: bigint;
    maxFirstSettlementDelay?: bigint;
    initialOwner?: string;
  } = {},
) {
  const values: Record<string, unknown> = {
    PRE: config.deployment.preAddress,
    USDC: config.deployment.usdcAddress,
    TREASURY: config.deployment.treasury,
    owner: safeAddress,
    MAX_MONTHLY_PERIODS_PER_SETTLEMENT: overrides.settlementLimit ?? 24n,
    MONTHLY_SCHEDULE_VERSION: overrides.scheduleVersion ?? 1n,
    MIN_FIRST_SETTLEMENT_DELAY: overrides.minFirstSettlementDelay ?? 7n * 24n * 60n * 60n,
    MAX_FIRST_SETTLEMENT_DELAY: overrides.maxFirstSettlementDelay ?? 60n * 24n * 60n * 60n,
  };
  return {
    getChainId: vi.fn().mockResolvedValue(config.deployment.chainId),
    getBytecode: vi.fn().mockResolvedValue('0x60006000'),
    readContract: vi
      .fn()
      .mockImplementation(({ functionName }: { functionName: string }) =>
        Promise.resolve(values[functionName]),
      ),
    getContractEvents: vi.fn().mockResolvedValue([
      {
        args: {
          previousOwner: zeroAddress,
          newOwner: overrides.initialOwner ?? config.deployment.owner,
        },
      },
    ]),
  };
}

describe('escrow deployment manifest verification', () => {
  it('accepts exact immutable values and an ownership transfer to the configured Safe', async () => {
    const client = manifestClient();

    await expect(
      verifyEscrowManifest(client as never, config.deployment, safeAddress),
    ).resolves.toMatchObject({
      chainId: config.deployment.chainId,
      initialOwner: config.deployment.owner.toLowerCase(),
      currentOwner: safeAddress,
      maxPeriodsPerSettlement: 24,
      monthlyScheduleVersion: 1,
      minFirstSettlementDelaySeconds: 604_800,
      maxFirstSettlementDelaySeconds: 5_184_000,
    });
    expect(client.getBytecode).toHaveBeenCalledWith({
      address: expect.any(String),
      blockNumber: BigInt(config.deployment.deploymentBlock),
    });
  });

  it('rejects a contract that does not expose the required settlement limit', async () => {
    await expect(
      verifyEscrowManifest(
        manifestClient({ settlementLimit: 12n }) as never,
        config.deployment,
        safeAddress,
      ),
    ).rejects.toThrow('settlement limit mismatch');
  });

  it.each([
    [{ scheduleVersion: 2n }, 'monthly schedule version mismatch'],
    [{ minFirstSettlementDelay: 6n * 24n * 60n * 60n }, 'minimum first settlement delay mismatch'],
    [{ maxFirstSettlementDelay: 61n * 24n * 60n * 60n }, 'maximum first settlement delay mismatch'],
  ] as const)('rejects incompatible monthly schedule constants', async (overrides, message) => {
    await expect(
      verifyEscrowManifest(manifestClient(overrides) as never, config.deployment, safeAddress),
    ).rejects.toThrow(message);
  });

  it('rejects a deployment-block owner proof that differs from the manifest', async () => {
    await expect(
      verifyEscrowManifest(
        manifestClient({
          initialOwner: '0x0000000000000000000000000000000000000006',
        }) as never,
        config.deployment,
        safeAddress,
      ),
    ).rejects.toThrow('initial owner does not match');
  });
});
