import {
  GoalManagerAssignmentSource,
  desiredGoalManagerSet,
  reconcileSafeOwnerGoalManagerAssignments,
} from '@precommunity/database';
import { describe, expect, it, vi } from 'vitest';

const owner = '0x1111111111111111111111111111111111111111';
const formerOwner = '0x2222222222222222222222222222222222222222';
const legacyManager = '0x3333333333333333333333333333333333333333';

describe('Safe owner goal manager policy', () => {
  it('adds current owners, retires former owners and preserves legacy managers', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const upsert = vi.fn().mockResolvedValue({});
    const database = {
      chainAuthority: {
        findMany: vi.fn().mockResolvedValue([{ address: legacyManager }]),
      },
      goalManagerAssignment: {
        findMany: vi.fn().mockResolvedValue([
          {
            address: formerOwner,
            source: GoalManagerAssignmentSource.SAFE_OWNER,
            desiredEnabled: true,
          },
        ]),
        updateMany,
        upsert,
      },
    } as never;

    const result = await reconcileSafeOwnerGoalManagerAssignments(database, {
      chainId: 84532,
      contractAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      safeOwners: [owner],
    });

    expect(result).toEqual({ safeOwners: 1, preservedLegacyManagers: 1 });

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          source: GoalManagerAssignmentSource.SAFE_OWNER,
          address: { notIn: [owner] },
        }),
        data: { desiredEnabled: false },
      }),
    );
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          address: owner,
          source: GoalManagerAssignmentSource.SAFE_OWNER,
          desiredEnabled: true,
        }),
      }),
    );
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          address: legacyManager,
          source: GoalManagerAssignmentSource.MANUAL,
          desiredEnabled: true,
        }),
      }),
    );
  });

  it('keeps every current Safe owner effective and honors manual pins after removal', () => {
    const assignments = [
      {
        address: formerOwner,
        source: GoalManagerAssignmentSource.SAFE_OWNER,
        desiredEnabled: false,
      },
      {
        address: formerOwner,
        source: GoalManagerAssignmentSource.MANUAL,
        desiredEnabled: true,
      },
      {
        address: owner,
        source: GoalManagerAssignmentSource.MANUAL,
        desiredEnabled: false,
      },
    ] as never;

    expect(desiredGoalManagerSet([owner], [], assignments)).toEqual(new Set([owner, formerOwner]));
  });

  it('revokes a former owner when no manual pin remains', () => {
    const assignments = [
      {
        address: formerOwner,
        source: GoalManagerAssignmentSource.SAFE_OWNER,
        desiredEnabled: false,
      },
      {
        address: formerOwner,
        source: GoalManagerAssignmentSource.MANUAL,
        desiredEnabled: false,
      },
    ] as never;

    expect(desiredGoalManagerSet([], [formerOwner], assignments)).toEqual(new Set());
  });
});
