import {
  BadRequestException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  ChainAuthorityKind,
  ExpenseCadence,
  ExpenseStatus,
  FundingAsset,
  FundingGoalType,
  FundingGoalStatus,
  GoalManagerAssignmentSource,
  MonthlySurplusPolicy,
  PayoutKind,
  PayoutStatus,
  Prisma,
  Role,
  SafeGoalActionKind,
  SafeGoalActionProposalStatus,
  SafeGoalManagerProposalStatus,
  SafePayoutProposalStatus,
} from '@precommunity/database';
import { DEFAULT_SUBPROJECT_NAME, DEFAULT_SUBPROJECT_SLUG } from '@precommunity/shared';
import { OperationType } from '@safe-global/types-kit';
import { decodeFunctionData, getAddress } from 'viem';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../common/prisma.service';
import { config } from '../config';
import type { SafeService } from '../safe/safe.service';
import {
  AdminService,
  encodeCreateGoalData,
  encodeCreateMonthlyGoalData,
  escrowAbi,
  goalManagerStateHash,
  parseFundingTarget,
} from './admin.service';

const actor = {
  userId: 'admin-id',
  address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  roles: [Role.SUPER_ADMIN],
  chainAuthorities: [ChainAuthorityKind.OWNER],
  chainOwnerAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  safeOwner: false,
  canAccessSafeOwnershipAcceptance: false,
  safeAddress: null,
};

const validDraftInput = {
  name: 'Public infrastructure',
  slug: 'public-infrastructure',
  description: '',
  purpose: 'Fund a verified community goal.',
  cadence: ExpenseCadence.ONE_TIME,
  recipientAddress: '0x1111111111111111111111111111111111111111',
  deadline: '2099-01-01T00:00:00.000Z',
  targets: [{ asset: FundingAsset.PRE, amount: '10' }],
};

afterEach(() => vi.useRealTimers());

describe('funding target validation', () => {
  it('keeps PRE and USDC precision exact', () => {
    expect(parseFundingTarget(FundingAsset.USDC, '1.000001')).toBe(1_000_001n);
    expect(() => parseFundingTarget(FundingAsset.USDC, '1.0000001')).toThrow(BadRequestException);
    expect(parseFundingTarget(FundingAsset.PRE, '1.000000000000000001')).toBe(
      1_000_000_000_000_000_001n,
    );
  });
});

describe('goal transaction encoding', () => {
  it('encodes every V1 createGoal argument in contract order', () => {
    const chainGoalId = `0x${'11'.repeat(32)}`;
    const recipientAddress = '0x1111111111111111111111111111111111111111';
    const deadline = new Date('2030-01-01T00:00:00.000Z');
    const data = encodeCreateGoalData({
      chainGoalId,
      recipientAddress,
      preTargetRaw: '100000000000000000000',
      usdcTargetRaw: '250000000',
      deadline,
      title: 'Public infrastructure',
      description: 'Fund a verified community goal.',
      metadataUri: 'ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3g5lxy4t5c7hr4zy2m4ot6owe',
    });
    const decoded = decodeFunctionData({ abi: escrowAbi, data });
    expect(decoded.functionName).toBe('createGoal');
    expect(decoded.args).toEqual([
      chainGoalId,
      getAddress(recipientAddress),
      100000000000000000000n,
      250000000n,
      1893456000n,
      'Public infrastructure',
      'Fund a verified community goal.',
      'ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3g5lxy4t5c7hr4zy2m4ot6owe',
    ]);
  });

  it('encodes an empty metadata URI when IPFS metadata is omitted', () => {
    const data = encodeCreateGoalData({
      chainGoalId: `0x${'33'.repeat(32)}`,
      recipientAddress: '0x1111111111111111111111111111111111111111',
      preTargetRaw: '1',
      usdcTargetRaw: '0',
      deadline: new Date('2099-01-01T00:00:00.000Z'),
      title: 'Minimal goal',
      description: 'Only core on-chain data.',
      metadataUri: null,
    });

    const decoded = decodeFunctionData({ abi: escrowAbi, data });
    expect(decoded.args?.at(-1)).toBe('');
  });

  it('encodes monthly creation with an explicit rollover policy and no deadline', () => {
    const chainGoalId = `0x${'55'.repeat(32)}`;
    const data = encodeCreateMonthlyGoalData({
      chainGoalId,
      recipientAddress: '0x1111111111111111111111111111111111111111',
      preTargetRaw: '100',
      usdcTargetRaw: '200',
      firstSettlementAt: null,
      monthlySurplusPolicy: MonthlySurplusPolicy.ROLL_OVER,
      title: 'Monthly public infrastructure',
      description: 'A stable monthly goal.',
      metadataUri: null,
    });

    const decoded = decodeFunctionData({ abi: escrowAbi, data });
    expect(decoded).toEqual({
      functionName: 'createMonthlyGoal',
      args: [
        chainGoalId,
        getAddress('0x1111111111111111111111111111111111111111'),
        100n,
        200n,
        0n,
        1,
        'Monthly public infrastructure',
        'A stable monthly goal.',
        '',
      ],
    });
  });

  it('encodes a custom first settlement timestamp before the surplus policy', () => {
    const firstSettlementAt = new Date('2030-02-15T00:00:00.000Z');
    const data = encodeCreateMonthlyGoalData({
      chainGoalId: `0x${'77'.repeat(32)}`,
      recipientAddress: '0x1111111111111111111111111111111111111111',
      preTargetRaw: '1',
      usdcTargetRaw: '0',
      firstSettlementAt,
      monthlySurplusPolicy: MonthlySurplusPolicy.PAYOUT_ALL,
      title: 'Custom monthly schedule',
      description: '',
      metadataUri: null,
    });

    const decoded = decodeFunctionData({ abi: escrowAbi, data });
    expect(decoded.args?.[4]).toBe(BigInt(firstSettlementAt.getTime() / 1_000));
    expect(decoded.args?.[5]).toBe(0);
  });
});

describe('monthly goal lifecycle authorization', () => {
  const chainGoalId = `0x${'66'.repeat(32)}`;
  const creatorAddress = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const monthlyGoal = {
    id: 'goal-id',
    chainGoalId,
    creatorAddress,
    status: FundingGoalStatus.OPEN,
    goalType: FundingGoalType.MONTHLY,
    deadline: new Date('2099-02-01T00:00:00.000Z'),
    monthlySurplusPolicy: MonthlySurplusPolicy.ROLL_OVER,
    monthlyStopRequestedAt: null,
  };

  function directPrisma() {
    return {
      project: { findUnique: vi.fn().mockResolvedValue({ id: 'project-id' }) },
      fundingGoal: { findUnique: vi.fn().mockResolvedValue(monthlyGoal) },
      auditEvent: { create: vi.fn().mockResolvedValue({}) },
    };
  }

  it('lets only the confirmed manager that created the goal change policy directly', async () => {
    const prisma = directPrisma();
    const manager = {
      ...actor,
      address: creatorAddress,
      roles: [Role.CONTENT_ADMIN, Role.FINANCE_ADMIN],
      chainAuthorities: [ChainAuthorityKind.GOAL_MANAGER],
      chainOwnerAddress: actor.address,
    };
    const result = await new AdminService(prisma as unknown as PrismaService).prepareGoalLifecycle(
      monthlyGoal.id,
      {
        kind: SafeGoalActionKind.SET_MONTHLY_SURPLUS_POLICY,
        monthlySurplusPolicy: MonthlySurplusPolicy.PAYOUT_ALL,
      },
      manager,
    );

    expect(result.mode).toBe('DIRECT');
    const decoded = decodeFunctionData({ abi: escrowAbi, data: result.transactionRequest.data });
    expect(decoded).toEqual({
      functionName: 'setMonthlySurplusPolicy',
      args: [chainGoalId, 0],
    });
    expect(prisma.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'PREPARE_DIRECT_MONTHLY_LIFECYCLE' }),
      }),
    );
  });

  it('rejects an unrelated confirmed goal manager', async () => {
    const prisma = directPrisma();
    const unrelatedManager = {
      ...actor,
      address: '0xcccccccccccccccccccccccccccccccccccccccc',
      roles: [Role.CONTENT_ADMIN, Role.FINANCE_ADMIN],
      chainAuthorities: [ChainAuthorityKind.GOAL_MANAGER],
      chainOwnerAddress: actor.address,
    };

    await expect(
      new AdminService(prisma as unknown as PrismaService).prepareGoalLifecycle(
        monthlyGoal.id,
        { kind: SafeGoalActionKind.REQUEST_MONTHLY_STOP },
        unrelatedManager,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
  });

  it('requires the Safe flow even when the former direct owner prepares emergency cancellation', async () => {
    const prisma = directPrisma();

    await expect(
      new AdminService(prisma as unknown as PrismaService).prepareGoalLifecycle(
        monthlyGoal.id,
        { kind: SafeGoalActionKind.CANCEL_MONTHLY },
        actor,
      ),
    ).rejects.toThrow('Emergency cancellation requires an owner of the Safe');
  });

  it('creates exact durable Safe calldata for emergency cancellation', async () => {
    const safeAddress = getAddress('0x2222222222222222222222222222222222222222');
    const expiresAt = new Date('2099-01-01T00:10:00.000Z');
    const transaction = {
      safeGoalActionIntent: {
        create: vi.fn().mockImplementation(({ data }) => ({ id: 'intent-id', ...data, expiresAt })),
      },
      auditEvent: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      ...directPrisma(),
      safeGoalActionIntent: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        findFirst: vi.fn().mockResolvedValue(null),
      },
      $transaction: vi.fn(async (callback: (tx: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    } as unknown as PrismaService;
    const safe = {
      assertPayoutReady: vi.fn().mockResolvedValue({
        address: safeAddress,
        threshold: 2,
        queueUrl: 'https://app.safe.global/transactions/queue?safe=basesep:test',
      }),
      nextNonce: vi.fn().mockResolvedValue(7),
    } as unknown as SafeService;
    const safeOwner = { ...actor, safeOwner: true, safeAddress };

    const result = await new AdminService(prisma, safe).prepareGoalLifecycle(
      monthlyGoal.id,
      { kind: SafeGoalActionKind.CANCEL_MONTHLY },
      safeOwner,
    );

    expect(result).toMatchObject({ mode: 'SAFE', id: 'intent-id', safeNonce: 7, threshold: 2 });
    const decoded = decodeFunctionData({ abi: escrowAbi, data: result.transactionRequest.data });
    expect(decoded).toEqual({ functionName: 'cancelMonthlyGoal', args: [chainGoalId] });
    expect(transaction.safeGoalActionIntent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kind: SafeGoalActionKind.CANCEL_MONTHLY,
        safeNonce: '7',
        data: result.transactionRequest.data.toLowerCase(),
      }),
    });
  });
});

describe('monthly Safe lifecycle submission protection', () => {
  const safeAddress = getAddress('0x2222222222222222222222222222222222222222');
  const safeTxHash = `0x${'77'.repeat(32)}`;
  const deadline = new Date('2099-02-01T00:00:00.000Z');
  const baseIntent = {
    id: 'intent-id',
    chainId: config.deployment.chainId,
    safeAddress: safeAddress.toLowerCase(),
    safeNonce: '7',
    toAddress: config.deployment.escrowAddress.toLowerCase(),
    valueRaw: '0',
    data: '0x1234',
    expiresAt: new Date('2099-01-01T00:10:00.000Z'),
    parameters: {
      expectedStatus: FundingGoalStatus.OPEN,
      expectedDeadline: deadline.toISOString(),
      expectedPolicy: MonthlySurplusPolicy.ROLL_OVER,
      expectedStopRequestedAt: null,
    },
    proposal: null,
    goal: {
      status: FundingGoalStatus.OPEN,
      goalType: FundingGoalType.MONTHLY,
      deadline,
      monthlySurplusPolicy: MonthlySurplusPolicy.ROLL_OVER,
      monthlyStopRequestedAt: null,
    },
  };
  const submission = {
    transaction: {} as never,
    safeTxHash,
    senderAddress: actor.address,
    senderSignature: '0x1234',
  };

  function safe(nextNonce = 7) {
    return {
      assertPayoutReady: vi.fn().mockResolvedValue({
        address: safeAddress,
        threshold: 2,
        queueUrl: 'https://app.safe.global/transactions/queue?safe=basesep:test',
      }),
      nextNonce: vi.fn().mockResolvedValue(nextNonce),
    } as unknown as SafeService;
  }

  it('rejects a signature submitted for another signed-in wallet', async () => {
    await expect(
      new AdminService({} as PrismaService, {} as SafeService).submitSafeGoalAction(
        baseIntent.id,
        { ...submission, senderAddress: '0xcccccccccccccccccccccccccccccccccccccccc' },
        actor,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects stale goal state and a changed Safe nonce before accepting signatures', async () => {
    const stalePrisma = {
      safeGoalActionIntent: {
        findUnique: vi.fn().mockResolvedValue({
          ...baseIntent,
          goal: { ...baseIntent.goal, monthlySurplusPolicy: MonthlySurplusPolicy.PAYOUT_ALL },
        }),
      },
    } as unknown as PrismaService;
    await expect(
      new AdminService(stalePrisma, safe()).submitSafeGoalAction(baseIntent.id, submission, actor),
    ).rejects.toThrow('The monthly goal changed');

    const noncePrisma = {
      safeGoalActionIntent: { findUnique: vi.fn().mockResolvedValue(baseIntent) },
    } as unknown as PrismaService;
    await expect(
      new AdminService(noncePrisma, safe(8)).submitSafeGoalAction(baseIntent.id, submission, actor),
    ).rejects.toThrow('The Safe nonce changed');
  });

  it('returns the already-submitted proposal without consuming or replaying the intent', async () => {
    const proposal = {
      id: 'proposal-id',
      safeTxHash,
      status: SafeGoalActionProposalStatus.AWAITING_CONFIRMATIONS,
      confirmations: 1,
      threshold: 2,
    };
    const nextNonce = vi.fn();
    const prisma = {
      safeGoalActionIntent: {
        findUnique: vi.fn().mockResolvedValue({ ...baseIntent, proposal }),
      },
    } as unknown as PrismaService;
    const safeService = {
      assertPayoutReady: vi.fn().mockResolvedValue({
        address: safeAddress,
        threshold: 2,
        queueUrl: 'https://app.safe.global/transactions/queue?safe=basesep:test',
      }),
      nextNonce,
    } as unknown as SafeService;

    await expect(
      new AdminService(prisma, safeService).submitSafeGoalAction(baseIntent.id, submission, actor),
    ).resolves.toMatchObject({ id: proposal.id, status: proposal.status });
    expect(nextNonce).not.toHaveBeenCalled();
  });
});

describe('operations workspace funding totals', () => {
  it('surfaces a migration instruction when the database schema is outdated', async () => {
    const prisma = {
      project: { findUnique: vi.fn().mockResolvedValue({ id: 'project-id' }) },
      subproject: {
        findMany: vi.fn().mockRejectedValue(
          new Prisma.PrismaClientKnownRequestError('column does not exist', {
            code: 'P2022',
            clientVersion: '0.0.0',
          }),
        ),
      },
    };

    await expect(new AdminService(prisma as unknown as PrismaService).list()).rejects.toThrow(
      ServiceUnavailableException,
    );
    await expect(new AdminService(prisma as unknown as PrismaService).list()).rejects.toThrow(
      'Database schema is outdated; run `pnpm db:migrate` and restart the API and worker services',
    );
  });

  it('returns bounded database aggregates instead of every contribution and release', async () => {
    const goal = {
      id: '00000000-0000-4000-8000-000000000010',
      status: 'CLOSED',
      deadline: new Date('2099-01-01T00:00:00.000Z'),
      preTargetRaw: '1000',
      usdcTargetRaw: '500',
      preRecipientEntitlementRaw: '800',
      usdcRecipientEntitlementRaw: '300',
    };
    const workspace = [
      {
        id: 'subproject-id',
        name: 'General',
        slug: 'general',
        expenses: [{ id: 'expense-id', targets: [], goals: [goal] }],
      },
    ];
    const prisma = {
      project: { findUnique: vi.fn().mockResolvedValue({ id: 'project-id' }) },
      subproject: { findMany: vi.fn().mockResolvedValue(workspace) },
      $queryRaw: vi
        .fn()
        .mockResolvedValueOnce([
          { goalId: goal.id, asset: FundingAsset.PRE, amountRaw: '800' },
          { goalId: goal.id, asset: FundingAsset.USDC, amountRaw: '300' },
        ])
        .mockResolvedValueOnce([
          { goalId: goal.id, asset: FundingAsset.PRE, kind: 'EXPENSE', amountRaw: '250' },
          {
            goalId: goal.id,
            asset: FundingAsset.USDC,
            kind: 'CANCELLED_FUNDS',
            amountRaw: '25',
          },
        ]),
    };

    const result = await new AdminService(prisma as unknown as PrismaService).list();
    const returnedGoal = result[0]!.expenses[0]!.goals[0]!;

    expect(returnedGoal.fundingTotals).toEqual({
      PRE: { fundedRaw: '800', expenseReleasedRaw: '250', cancelledFundsReleasedRaw: '0' },
      USDC: { fundedRaw: '300', expenseReleasedRaw: '0', cancelledFundsReleasedRaw: '25' },
    });
    const goalSelection =
      prisma.subproject.findMany.mock.calls[0]![0]!.include.expenses.include.goals;
    expect(goalSelection.where).toEqual({
      chainId: config.deployment.chainId,
      creationTxHash: { not: null },
    });
    expect(goalSelection).not.toHaveProperty('include');
    expect(goalSelection.select).not.toHaveProperty('creationBlock');
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
  });
});

describe('goal draft organization and optional metadata', () => {
  it('assigns an omitted subproject to General and stores absent metadata as null', async () => {
    const general = {
      id: 'general-id',
      projectId: 'project-id',
      name: DEFAULT_SUBPROJECT_NAME,
      slug: DEFAULT_SUBPROJECT_SLUG,
      archivedAt: null,
    };
    const created = {
      id: 'draft-id',
      ...validDraftInput,
      category: null,
      discussionUrl: null,
      subproject: general,
      targets: [],
    };
    const transaction = {
      subproject: { findFirst: vi.fn().mockResolvedValue(general) },
      expense: { create: vi.fn().mockResolvedValue(created) },
      auditEvent: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      project: { findUnique: vi.fn().mockResolvedValue({ id: 'project-id' }) },
      $transaction: vi.fn(async (callback: (tx: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    } as unknown as PrismaService;

    const result = await new AdminService(prisma).createExpense(validDraftInput, actor);

    expect(transaction.subproject.findFirst).toHaveBeenCalledWith({
      where: { projectId: 'project-id', slug: DEFAULT_SUBPROJECT_SLUG, archivedAt: null },
    });
    expect(transaction.expense.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          subprojectId: general.id,
          category: null,
          discussionUrl: null,
        }),
      }),
    );
    expect(result.canonicalMetadata).toEqual({ schema: 'precommunity.goal-metadata.v1' });
  });

  it('keeps an explicit project subproject in canonical metadata', async () => {
    const subproject = {
      id: 'nodes-id',
      projectId: 'project-id',
      name: 'Public nodes',
      slug: 'public-nodes',
      archivedAt: null,
    };
    const input = {
      ...validDraftInput,
      subprojectId: subproject.id,
      category: 'Infrastructure',
      discussionUrl: 'https://example.org/discussion',
    };
    const created = { id: 'draft-id', ...input, subproject, targets: [] };
    const transaction = {
      subproject: { findFirst: vi.fn().mockResolvedValue(subproject) },
      expense: { create: vi.fn().mockResolvedValue(created) },
      auditEvent: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      project: { findUnique: vi.fn().mockResolvedValue({ id: 'project-id' }) },
      $transaction: vi.fn(async (callback: (tx: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    } as unknown as PrismaService;

    const result = await new AdminService(prisma).createExpense(input, actor);

    expect(transaction.subproject.findFirst).toHaveBeenCalledWith({
      where: { id: subproject.id, projectId: 'project-id', archivedAt: null },
    });
    expect(result.canonicalMetadata).toEqual({
      schema: 'precommunity.goal-metadata.v1',
      category: 'Infrastructure',
      subproject: { name: 'Public nodes', slug: 'public-nodes' },
      discussionUrl: 'https://example.org/discussion',
    });
  });

  it('rejects a subproject that does not belong to the configured project', async () => {
    const transaction = {
      subproject: { findFirst: vi.fn().mockResolvedValue(null) },
      expense: { create: vi.fn() },
      auditEvent: { create: vi.fn() },
    };
    const prisma = {
      project: { findUnique: vi.fn().mockResolvedValue({ id: 'project-id' }) },
      $transaction: vi.fn(async (callback: (tx: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    } as unknown as PrismaService;

    await expect(
      new AdminService(prisma).createExpense(
        {
          ...validDraftInput,
          subprojectId: 'foreign-id',
        },
        actor,
      ),
    ).rejects.toThrow(BadRequestException);
    expect(transaction.expense.create).not.toHaveBeenCalled();
  });

  it('clears nullable metadata with null and leaves it unchanged when omitted', async () => {
    const before = {
      id: 'draft-id',
      status: ExpenseStatus.DRAFT,
      cadence: ExpenseCadence.ONE_TIME,
      monthlySurplusPolicy: null,
      firstSettlementAtOverride: null,
      deadline: new Date('2099-01-01T00:00:00.000Z'),
      name: validDraftInput.name,
      purpose: validDraftInput.purpose,
      metadataUri: null,
      targets: [],
    };
    const transaction = {
      expense: { update: vi.fn().mockResolvedValue(before) },
      auditEvent: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      project: { findUnique: vi.fn().mockResolvedValue({ id: 'project-id' }) },
      expense: { findUnique: vi.fn().mockResolvedValue(before) },
      $transaction: vi.fn(async (callback: (tx: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    } as unknown as PrismaService;
    const service = new AdminService(prisma);

    await service.updateExpense('draft-id', { category: null, discussionUrl: null }, actor);
    await service.updateExpense('draft-id', {}, actor);

    expect(transaction.expense.update).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({ category: null, discussionUrl: null }),
      }),
    );
    expect(transaction.expense.update).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({ category: undefined, discussionUrl: undefined }),
      }),
    );
  });

  it('keeps an omitted monthly override unchanged and clears it with null', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-01T00:00:00.000Z'));
    const firstSettlementAtOverride = new Date('2026-08-20T00:00:00.000Z');
    const before = {
      id: 'monthly-draft-id',
      status: ExpenseStatus.DRAFT,
      cadence: ExpenseCadence.MONTHLY,
      monthlySurplusPolicy: MonthlySurplusPolicy.ROLL_OVER,
      firstSettlementAtOverride,
      deadline: null,
      name: 'Monthly goal',
      purpose: '',
      metadataUri: null,
      targets: [],
    };
    const update = vi.fn().mockImplementation(({ data }) => ({
      ...before,
      firstSettlementAtOverride:
        data.firstSettlementAtOverride === undefined
          ? before.firstSettlementAtOverride
          : data.firstSettlementAtOverride,
    }));
    const transaction = {
      expense: { update },
      auditEvent: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      project: { findUnique: vi.fn().mockResolvedValue({ id: 'project-id' }) },
      expense: { findUnique: vi.fn().mockResolvedValue(before) },
      $transaction: vi.fn(async (callback: (tx: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    } as unknown as PrismaService;
    const service = new AdminService(prisma);

    await service.updateExpense(before.id, {}, actor);
    await service.updateExpense(before.id, { firstSettlementAt: null }, actor);

    expect(update.mock.calls[0]![0].data.firstSettlementAtOverride).toBeUndefined();
    expect(update.mock.calls[1]![0].data.firstSettlementAtOverride).toBeNull();
  });
});

describe('goal cadence validation', () => {
  const prisma = {
    project: { findUnique: vi.fn().mockResolvedValue({ id: 'project-id' }) },
  } as unknown as PrismaService;

  it('requires deadline only for one-time goals', async () => {
    await expect(
      new AdminService(prisma).createExpense({ ...validDraftInput, deadline: undefined }, actor),
    ).rejects.toThrow('A one-time goal requires a deadline');
    await expect(
      new AdminService(prisma).createExpense(
        {
          ...validDraftInput,
          cadence: ExpenseCadence.MONTHLY,
          monthlySurplusPolicy: MonthlySurplusPolicy.PAYOUT_ALL,
        },
        actor,
      ),
    ).rejects.toThrow('A monthly goal cannot define a deadline');
  });

  it('requires policy only for monthly goals', async () => {
    await expect(
      new AdminService(prisma).createExpense(
        {
          ...validDraftInput,
          monthlySurplusPolicy: MonthlySurplusPolicy.ROLL_OVER,
        },
        actor,
      ),
    ).rejects.toThrow('A one-time goal cannot define a monthly surplus policy');
    await expect(
      new AdminService(prisma).createExpense(
        {
          ...validDraftInput,
          cadence: ExpenseCadence.MONTHLY,
          deadline: undefined,
        },
        actor,
      ),
    ).rejects.toThrow('A monthly goal requires an explicit surplus policy');
  });

  it('rejects the first settlement field for a one-time goal, including null', async () => {
    for (const firstSettlementAt of ['2099-02-01T00:00:00.000Z', null]) {
      await expect(
        new AdminService(prisma).createExpense(
          {
            ...validDraftInput,
            firstSettlementAt,
          },
          actor,
        ),
      ).rejects.toThrow('A one-time goal cannot define a first settlement date');
    }
  });

  it('rejects a custom first settlement date when updating a one-time draft', async () => {
    const before = {
      id: 'draft-id',
      status: ExpenseStatus.DRAFT,
      cadence: ExpenseCadence.ONE_TIME,
      monthlySurplusPolicy: null,
      firstSettlementAtOverride: null,
      deadline: new Date('2099-01-01T00:00:00.000Z'),
      name: validDraftInput.name,
      purpose: validDraftInput.purpose,
      metadataUri: null,
      targets: [],
    };
    const updatePrisma = {
      project: { findUnique: vi.fn().mockResolvedValue({ id: 'project-id' }) },
      expense: { findUnique: vi.fn().mockResolvedValue(before) },
    } as unknown as PrismaService;
    const service = new AdminService(updatePrisma);

    await expect(
      service.updateExpense(before.id, { firstSettlementAt: '2099-02-01T00:00:00.000Z' }, actor),
    ).rejects.toThrow('A one-time goal cannot define a first settlement date');
  });

  it('updates every publication field and can switch an unpublished draft to monthly', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-01T00:00:00.000Z'));
    const before = {
      id: 'draft-id',
      status: ExpenseStatus.DRAFT,
      subprojectId: 'old-subproject-id',
      cadence: ExpenseCadence.ONE_TIME,
      monthlySurplusPolicy: null,
      firstSettlementAtOverride: null,
      deadline: new Date('2099-01-01T00:00:00.000Z'),
      name: validDraftInput.name,
      purpose: validDraftInput.purpose,
      metadataUri: null,
      targets: [],
    };
    const destination = { id: 'new-subproject-id' };
    const update = vi.fn().mockImplementation(({ data }) => ({ ...before, ...data }));
    const transaction = {
      subproject: { findFirst: vi.fn().mockResolvedValue(destination) },
      fundingTarget: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
      expense: { update },
      auditEvent: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      project: { findUnique: vi.fn().mockResolvedValue({ id: 'project-id' }) },
      expense: { findUnique: vi.fn().mockResolvedValue(before) },
      $transaction: vi.fn(async (callback: (tx: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    } as unknown as PrismaService;

    await new AdminService(prisma).updateExpense(
      before.id,
      {
        subprojectId: destination.id,
        slug: 'edited-monthly-goal',
        name: 'Edited monthly goal',
        description: 'Internal notes',
        purpose: 'Updated on-chain description',
        category: 'Operations',
        cadence: ExpenseCadence.MONTHLY,
        monthlySurplusPolicy: MonthlySurplusPolicy.ROLL_OVER,
        firstSettlementAt: '2026-08-20T00:00:00.000Z',
        recipientAddress: '0x2222222222222222222222222222222222222222',
        deadline: null,
        discussionUrl: 'https://example.org/discussion',
        metadataUri: null,
        documents: [{ label: 'Brief', url: 'https://example.org/brief' }],
        targets: [{ asset: FundingAsset.USDC, amount: '2500' }],
      },
      actor,
    );

    expect(transaction.subproject.findFirst).toHaveBeenCalledWith({
      where: { id: destination.id, projectId: 'project-id', archivedAt: null },
    });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          subprojectId: destination.id,
          slug: 'edited-monthly-goal',
          cadence: ExpenseCadence.MONTHLY,
          deadline: null,
          monthlySurplusPolicy: MonthlySurplusPolicy.ROLL_OVER,
          firstSettlementAtOverride: new Date('2026-08-20T00:00:00.000Z'),
          targets: { create: [{ asset: FundingAsset.USDC, amount: '2500' }] },
        }),
      }),
    );
  });

  it('accepts exact 7 and 60 day monthly bounds and persists the chosen dates', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-01T00:00:00.000Z'));
    const general = {
      id: 'general-id',
      projectId: 'project-id',
      name: DEFAULT_SUBPROJECT_NAME,
      slug: DEFAULT_SUBPROJECT_SLUG,
      archivedAt: null,
    };
    const create = vi.fn().mockImplementation(({ data }) => ({
      id: 'draft-id',
      ...data,
      category: null,
      discussionUrl: null,
      subproject: general,
      targets: [],
    }));
    const transaction = {
      subproject: { findFirst: vi.fn().mockResolvedValue(general) },
      expense: { create },
      auditEvent: { create: vi.fn().mockResolvedValue({}) },
    };
    const boundedPrisma = {
      project: { findUnique: vi.fn().mockResolvedValue({ id: 'project-id' }) },
      $transaction: vi.fn(async (callback: (tx: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    } as unknown as PrismaService;
    const monthlyInput = {
      ...validDraftInput,
      cadence: ExpenseCadence.MONTHLY,
      deadline: undefined,
      monthlySurplusPolicy: MonthlySurplusPolicy.ROLL_OVER,
    };
    const service = new AdminService(boundedPrisma);

    await service.createExpense(
      { ...monthlyInput, firstSettlementAt: '2026-08-08T00:00:00.000Z' },
      actor,
    );
    await service.createExpense(
      { ...monthlyInput, firstSettlementAt: '2026-09-30T00:00:00.000Z' },
      actor,
    );

    expect(create.mock.calls.map(([input]) => input.data.firstSettlementAtOverride)).toEqual([
      new Date('2026-08-08T00:00:00.000Z'),
      new Date('2026-09-30T00:00:00.000Z'),
    ]);
    expect(transaction.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          after: expect.objectContaining({
            monthlySchedule: {
              mode: 'CUSTOM',
              firstSettlementAt: '2026-09-30T00:00:00.000Z',
            },
          }),
        }),
      }),
    );
  });

  it('rejects monthly overrides outside 7–60 days or away from UTC midnight', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-01T00:00:00.000Z'));
    const monthlyInput = {
      ...validDraftInput,
      cadence: ExpenseCadence.MONTHLY,
      deadline: undefined,
      monthlySurplusPolicy: MonthlySurplusPolicy.PAYOUT_ALL,
    };
    const service = new AdminService(prisma);

    await expect(
      service.createExpense(
        { ...monthlyInput, firstSettlementAt: '2026-08-07T00:00:00.000Z' },
        actor,
      ),
    ).rejects.toThrow('between 7 and 60 days');
    await expect(
      service.createExpense(
        { ...monthlyInput, firstSettlementAt: '2026-10-01T00:00:00.000Z' },
        actor,
      ),
    ).rejects.toThrow('between 7 and 60 days');
    await expect(
      service.createExpense(
        { ...monthlyInput, firstSettlementAt: '2026-08-08T01:00:00.000Z' },
        actor,
      ),
    ).rejects.toThrow('00:00 UTC');
  });

  it('revalidates a saved custom date immediately before publication', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-10T00:00:00.000Z'));
    const draft = {
      id: 'draft-id',
      status: ExpenseStatus.DRAFT,
      cadence: ExpenseCadence.MONTHLY,
      deadline: null,
      monthlySurplusPolicy: MonthlySurplusPolicy.PAYOUT_ALL,
      firstSettlementAtOverride: new Date('2026-08-16T00:00:00.000Z'),
      targets: [{ asset: FundingAsset.PRE, amount: { toString: () => '10' } }],
      name: 'Monthly goal',
      purpose: '',
      metadataUri: null,
    };
    const publishPrisma = {
      project: { findUnique: vi.fn().mockResolvedValue({ id: 'project-id' }) },
      expense: { findUnique: vi.fn().mockResolvedValue(draft) },
    } as unknown as PrismaService;

    await expect(new AdminService(publishPrisma).publishExpense(draft.id, actor)).rejects.toThrow(
      'between 7 and 60 days',
    );
  });
});

describe('goal publication authorization', () => {
  it('does not let an off-chain content role prepare creator calldata', async () => {
    const contentOnlyActor = {
      ...actor,
      roles: [Role.CONTENT_ADMIN],
      chainAuthorities: [],
      chainOwnerAddress: actor.address,
    };

    await expect(
      new AdminService({} as PrismaService).publishExpense('draft-id', contentOnlyActor),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('atomic administrative mutations', () => {
  it('does not allow PostgreSQL to grant root authority', async () => {
    const prisma = {} as PrismaService;
    await expect(
      new AdminService(prisma).assignRoles(
        {
          address: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          roles: [Role.SUPER_ADMIN],
        },
        actor,
      ),
    ).rejects.toThrow('SUPER_ADMIN follows the on-chain contract owner');
  });

  it('assigns roles and writes the audit event in the same transaction', async () => {
    const user = {
      id: 'user-id',
      address: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      roles: [Role.CONTENT_ADMIN],
    };
    const transaction = {
      user: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockResolvedValue(user),
      },
      auditEvent: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      project: { findUnique: vi.fn().mockResolvedValue({ id: 'project-id' }) },
      $transaction: vi.fn(async (callback: (tx: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    } as unknown as PrismaService;

    const result = await new AdminService(prisma).assignRoles(
      { address: user.address, roles: user.roles },
      actor,
    );

    expect(result).toEqual(user);
    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(transaction.user.upsert).toHaveBeenCalledOnce();
    expect(transaction.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'ASSIGN_ROLES', entityId: user.id }),
      }),
    );
  });

  it('marks a prepared draft pending only after a confirmed submission is reported', async () => {
    const draft = {
      id: 'draft-id',
      status: ExpenseStatus.DRAFT,
      pendingChainGoalId: `0x${'11'.repeat(32)}`,
    };
    const pending = { ...draft, status: ExpenseStatus.PENDING_CHAIN };
    const transaction = {
      expense: {
        findUnique: vi.fn().mockResolvedValue(draft),
        update: vi.fn().mockResolvedValue(pending),
      },
      auditEvent: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      project: { findUnique: vi.fn().mockResolvedValue({ id: 'project-id' }) },
      $transaction: vi.fn(async (callback: (tx: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    } as unknown as PrismaService;

    await expect(
      new AdminService(prisma).markExpenseSubmitted(
        'draft-id',
        { txHash: `0x${'22'.repeat(32)}` },
        actor,
      ),
    ).resolves.toEqual(pending);
    expect(transaction.expense.update).toHaveBeenCalledWith({
      where: { id: 'draft-id' },
      data: { status: ExpenseStatus.PENDING_CHAIN, pendingChainTxHash: `0x${'22'.repeat(32)}` },
    });
    expect(transaction.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'CHAIN_PUBLICATION_SUBMITTED' }),
      }),
    );
  });
});

describe('goal closing', () => {
  it('closes with only the goal id and assigns all confirmed funds to the recipient', async () => {
    const chainGoalId = `0x${'44'.repeat(32)}`;
    const audit = vi.fn().mockResolvedValue({});
    const prisma = {
      project: { findUnique: vi.fn().mockResolvedValue({ id: 'project-id' }) },
      fundingGoal: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'goal-id',
          chainGoalId,
          status: FundingGoalStatus.OPEN,
          goalType: FundingGoalType.ONE_TIME,
        }),
      },
      auditEvent: { create: audit },
    } as unknown as PrismaService;

    const result = await new AdminService(prisma).closeProposal('goal-id', actor);
    const decoded = decodeFunctionData({ abi: escrowAbi, data: result.transactionRequest.data });

    expect(decoded).toEqual({ functionName: 'closeGoal', args: [chainGoalId] });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'PREPARE_CLOSE',
          after: { recipientEntitlement: 'ALL_CONFIRMED_CONTRIBUTIONS' },
        }),
      }),
    );
  });
});

describe('Safe payout preparation', () => {
  it('creates an exact Safe intent without broadcasting a direct payout', async () => {
    const chainGoalId = `0x${'44'.repeat(32)}`;
    const expiresAt = new Date('2026-08-15T12:10:00.000Z');
    const findGoal = vi.fn().mockResolvedValue({
      id: 'goal-id',
      chainGoalId,
      status: FundingGoalStatus.CLOSED,
      goalType: FundingGoalType.ONE_TIME,
      recipientAddress: '0x1111111111111111111111111111111111111111',
      preRecipientEntitlementRaw: '700',
      usdcRecipientEntitlementRaw: '0',
      preTreasuryEntitlementRaw: '0',
      usdcTreasuryEntitlementRaw: '0',
      payouts: [],
    });
    const transaction = {
      payout: {
        create: vi.fn().mockResolvedValue({ id: 'payout-id' }),
      },
      safePayoutIntent: {
        create: vi.fn().mockImplementation(({ data }) => ({ id: 'intent-id', ...data, expiresAt })),
      },
      auditEvent: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      project: { findUnique: vi.fn().mockResolvedValue({ id: 'project-id' }) },
      fundingGoal: {
        findUnique: findGoal,
      },
      safePayoutIntent: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue(null),
      },
      $transaction: vi.fn(async (callback: (tx: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    } as unknown as PrismaService;
    const safe = {
      assertPayoutReady: vi.fn().mockResolvedValue({
        address: getAddress('0x2222222222222222222222222222222222222222'),
        threshold: 2,
        queueUrl: 'https://app.safe.global/transactions/queue?safe=basesep:test',
      }),
      nextNonce: vi.fn().mockResolvedValue(7),
    } as unknown as SafeService;

    const result = await new AdminService(prisma, safe).createSafePayoutIntent(
      'goal-id',
      { asset: FundingAsset.PRE, kind: 'EXPENSE', amountRaw: '700' },
      actor,
    );
    const decoded = decodeFunctionData({ abi: escrowAbi, data: result.transactionRequest.data });

    expect(decoded.functionName).toBe('releaseExpense');
    expect(decoded.args).toEqual([chainGoalId, getAddress(config.deployment.preAddress), 700n]);
    expect(result).toMatchObject({
      id: 'intent-id',
      safeNonce: 7,
      threshold: 2,
      transactionRequest: { chainId: config.deployment.chainId },
    });
    expect(findGoal).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'goal-id', chainId: config.deployment.chainId },
      }),
    );
    expect(transaction.payout.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kind: PayoutKind.EXPENSE,
        status: PayoutStatus.PROPOSED,
        amountRaw: '700',
      }),
    });
  });

  it('does not create a treasury payout for a closed goal', async () => {
    const prisma = {
      project: { findUnique: vi.fn().mockResolvedValue({ id: 'project-id' }) },
      safePayoutIntent: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue(null),
      },
      fundingGoal: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'goal-id',
          chainGoalId: `0x${'44'.repeat(32)}`,
          status: FundingGoalStatus.CLOSED,
          goalType: FundingGoalType.ONE_TIME,
          recipientAddress: '0x1111111111111111111111111111111111111111',
          preRecipientEntitlementRaw: '700',
          usdcRecipientEntitlementRaw: '0',
          preTreasuryEntitlementRaw: '0',
          usdcTreasuryEntitlementRaw: '0',
          payouts: [],
        }),
      },
    } as unknown as PrismaService;
    const safe = {
      assertPayoutReady: vi.fn().mockResolvedValue({
        address: getAddress('0x2222222222222222222222222222222222222222'),
        threshold: 2,
        queueUrl: 'https://app.safe.global/transactions/queue?safe=basesep:test',
      }),
    } as unknown as SafeService;

    await expect(
      new AdminService(prisma, safe).createSafePayoutIntent(
        'goal-id',
        { asset: FundingAsset.PRE, kind: 'CANCELLED_FUNDS', amountRaw: '1' },
        actor,
      ),
    ).rejects.toThrow('Treasury funds require a cancelled goal');
  });

  it('lets another Safe owner retry the same submitting intent', async () => {
    const safeAddress = getAddress('0x2222222222222222222222222222222222222222');
    const nextNonce = vi.fn();
    const prisma = {
      safePayoutIntent: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue({
          id: 'intent-id',
          goalId: 'goal-id',
          safeAddress: safeAddress.toLowerCase(),
          safeNonce: '7',
          toAddress: config.deployment.escrowAddress.toLowerCase(),
          valueRaw: '0',
          data: '0x1234',
          createdByAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          expiresAt: new Date('2026-08-15T12:10:00.000Z'),
          consumedAt: new Date('2026-08-15T12:01:00.000Z'),
          proposal: { status: SafePayoutProposalStatus.SUBMITTING },
          payout: {
            asset: FundingAsset.PRE,
            kind: PayoutKind.EXPENSE,
            amountRaw: '100',
            status: PayoutStatus.PROPOSED,
          },
        }),
      },
    } as unknown as PrismaService;
    const safe = {
      assertPayoutReady: vi.fn().mockResolvedValue({
        address: safeAddress,
        threshold: 2,
        queueUrl: 'https://app.safe.global/transactions/queue?safe=basesep:test',
      }),
      nextNonce,
    } as unknown as SafeService;

    await expect(
      new AdminService(prisma, safe).createSafePayoutIntent(
        'goal-id',
        { asset: FundingAsset.PRE, kind: 'EXPENSE', amountRaw: '100' },
        actor,
      ),
    ).resolves.toMatchObject({
      id: 'intent-id',
      safeNonce: 7,
      transactionRequest: { chainId: config.deployment.chainId, data: '0x1234' },
    });
    expect(nextNonce).not.toHaveBeenCalled();
  });

  it('blocks ownership migration until a direct goal manager is confirmed', async () => {
    const prisma = {
      chainAuthority: { count: vi.fn().mockResolvedValue(0) },
    } as unknown as PrismaService;
    const safe = {
      configuredAddress: vi
        .fn()
        .mockReturnValue(getAddress('0x2222222222222222222222222222222222222222')),
      transactionServiceReady: vi.fn().mockResolvedValue(true),
      ownershipTransferRequest: vi.fn(),
    } as unknown as SafeService;

    await expect(
      new AdminService(prisma, safe).prepareSafeOwnershipTransfer(actor),
    ).rejects.toThrow('Add and confirm at least one direct goal manager');
    expect(safe.ownershipTransferRequest).not.toHaveBeenCalled();
  });

  it('reports the pending Safe owner and its acceptance proposal', async () => {
    const safeAddress = getAddress('0x2222222222222222222222222222222222222222');
    const proposal = {
      safeTxHash: `0x${'66'.repeat(32)}`,
      safeNonce: 7,
      confirmations: 1,
      threshold: 2,
      readyToExecute: false,
      queueUrl: 'https://app.safe.global/transactions/queue?safe=basesep:test',
    };
    const prisma = {
      chainAuthority: { count: vi.fn().mockResolvedValue(1) },
    } as unknown as PrismaService;
    const safe = {
      configuredAddress: vi.fn().mockReturnValue(safeAddress),
      runtimeInfo: vi.fn().mockResolvedValue({
        address: safeAddress,
        owners: [getAddress(actor.address)],
        threshold: 2,
        nonce: 7,
        escrowOwner: getAddress(actor.address),
        isEscrowOwner: false,
        pendingOwner: safeAddress,
        isPendingEscrowOwner: true,
        queueUrl: proposal.queueUrl,
      }),
      transactionServiceReady: vi.fn().mockResolvedValue(true),
      ownershipAcceptanceStatus: vi.fn().mockResolvedValue(proposal),
    } as unknown as SafeService;

    await expect(new AdminService(prisma, safe).safeStatus(actor)).resolves.toMatchObject({
      chainId: config.deployment.chainId,
      escrowAddress: config.deployment.escrowAddress,
      isEscrowOwner: false,
      pendingOwner: safeAddress,
      isPendingEscrowOwner: true,
      ownershipAcceptance: proposal,
      safeOwner: true,
    });
  });

  it('prepares and audits the Safe ownership acceptance request', async () => {
    const safeAddress = getAddress('0x2222222222222222222222222222222222222222');
    const acceptance = {
      safeAddress,
      safeNonce: 7,
      threshold: 2,
      queueUrl: 'https://app.safe.global/transactions/queue?safe=basesep:test',
      transactionRequest: {
        chainId: config.deployment.chainId,
        to: getAddress(config.deployment.escrowAddress),
        value: '0',
        data: '0x79ba5097',
      },
      existingProposal: null,
    };
    const audit = vi.fn().mockResolvedValue({});
    const prisma = {
      project: { findUnique: vi.fn().mockResolvedValue({ id: 'project-id' }) },
      auditEvent: { create: audit },
    } as unknown as PrismaService;
    const safe = {
      ownershipAcceptanceRequest: vi.fn().mockResolvedValue(acceptance),
    } as unknown as SafeService;

    await expect(
      new AdminService(prisma, safe).prepareSafeOwnershipAcceptance(actor),
    ).resolves.toEqual(acceptance);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'PREPARE_SAFE_OWNERSHIP_ACCEPTANCE',
          after: expect.objectContaining({ safeNonce: 7 }),
        }),
      }),
    );
  });

  it('verifies and submits the exact ownership acceptance proposal', async () => {
    const safeTxHash = `0x${'77'.repeat(32)}`;
    const transaction = {
      to: getAddress(config.deployment.escrowAddress),
      value: '0',
      data: '0x79ba5097',
      operation: OperationType.Call,
      safeTxGas: '0',
      baseGas: '0',
      gasPrice: '0',
      gasToken: '0x0000000000000000000000000000000000000000',
      refundReceiver: '0x0000000000000000000000000000000000000000',
      nonce: 7,
    };
    const validateTransactionData = vi.fn();
    const propose = vi.fn().mockResolvedValue(undefined);
    const safe = {
      ownershipAcceptanceRequest: vi.fn().mockResolvedValue({
        safeAddress: getAddress('0x2222222222222222222222222222222222222222'),
        safeNonce: 7,
        threshold: 2,
        queueUrl: 'https://app.safe.global/transactions/queue?safe=basesep:test',
        transactionRequest: {
          chainId: config.deployment.chainId,
          to: transaction.to,
          value: transaction.value,
          data: transaction.data,
        },
        existingProposal: null,
      }),
      validateTransactionData,
      transactionHash: vi.fn().mockResolvedValue(safeTxHash),
      propose,
    } as unknown as SafeService;

    await expect(
      new AdminService({} as PrismaService, safe).submitSafeOwnershipAcceptance(
        {
          transaction,
          safeTxHash,
          senderAddress: actor.address,
          senderSignature: '0x1234',
        },
        actor,
      ),
    ).resolves.toMatchObject({
      safeTxHash,
      safeNonce: 7,
      confirmations: 1,
      threshold: 2,
      readyToExecute: false,
    });
    expect(validateTransactionData).toHaveBeenCalledWith(
      transaction,
      { to: transaction.to, value: '0', data: '0x79ba5097', nonce: 7 },
      'ownership acceptance request',
    );
    expect(propose).toHaveBeenCalledWith(
      expect.objectContaining({
        transaction,
        safeTxHash,
        senderAddress: actor.address,
        senderSignature: '0x1234',
      }),
    );
  });

  it('persists a submitting proposal before calling Safe', async () => {
    const safeAddress = getAddress('0x2222222222222222222222222222222222222222');
    const safeTxHash = `0x${'77'.repeat(32)}`;
    const now = new Date('2026-08-15T12:00:00.000Z');
    const payout = {
      id: 'payout-id',
      asset: FundingAsset.PRE,
      kind: PayoutKind.EXPENSE,
      amountRaw: '100',
      recipientAddress: '0x1111111111111111111111111111111111111111',
      status: PayoutStatus.PROPOSED,
    };
    const intent = {
      id: 'intent-id',
      payoutId: payout.id,
      goalId: 'goal-id',
      chainId: config.deployment.chainId,
      safeAddress: safeAddress.toLowerCase(),
      safeNonce: '7',
      toAddress: config.deployment.escrowAddress.toLowerCase(),
      valueRaw: '0',
      data: '0x1234',
      createdByAddress: actor.address,
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      consumedAt: null,
      proposal: null,
      payout,
    };
    const submitting = {
      id: 'proposal-id',
      intentId: intent.id,
      safeTxHash,
      safeNonce: intent.safeNonce,
      senderAddress: actor.address,
      confirmations: 1,
      threshold: 2,
      status: SafePayoutProposalStatus.SUBMITTING,
      executionTxHash: null,
      failureReason: null,
      lastCheckedAt: null,
      executedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const createProposal = vi.fn().mockResolvedValue(submitting);
    const transaction = {
      safePayoutProposal: {
        create: createProposal,
        updateMany: vi.fn(),
        findUniqueOrThrow: vi.fn(),
      },
      safePayoutIntent: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      auditEvent: { create: vi.fn().mockResolvedValue({}) },
    };
    const markSubmissionUnconfirmed = vi.fn().mockResolvedValue(submitting);
    const prisma = {
      project: { findUnique: vi.fn().mockResolvedValue({ id: 'project-id' }) },
      safePayoutIntent: { findUnique: vi.fn().mockResolvedValue(intent) },
      safePayoutProposal: {
        findUnique: vi.fn(),
        updateMany: markSubmissionUnconfirmed,
      },
      $transaction: vi.fn(async (callback: (tx: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    } as unknown as PrismaService;
    const propose = vi.fn().mockRejectedValue(new ServiceUnavailableException('Safe unavailable'));
    const safe = {
      assertPayoutReady: vi.fn().mockResolvedValue({
        address: safeAddress,
        threshold: 2,
        queueUrl: 'https://app.safe.global/transactions/queue?safe=basesep:test',
      }),
      nextNonce: vi.fn().mockResolvedValue(7),
      validateTransactionData: vi.fn(),
      transactionHash: vi.fn().mockResolvedValue(safeTxHash),
      propose,
    } as unknown as SafeService;

    await expect(
      new AdminService(prisma, safe).submitSafePayoutProposal(
        intent.id,
        {
          transaction: {
            to: intent.toAddress,
            value: '0',
            data: intent.data,
            operation: OperationType.Call,
            safeTxGas: '0',
            baseGas: '0',
            gasPrice: '0',
            gasToken: '0x0000000000000000000000000000000000000000',
            refundReceiver: '0x0000000000000000000000000000000000000000',
            nonce: 7,
          },
          safeTxHash,
          senderAddress: actor.address,
          senderSignature: '0x1234',
        },
        actor,
      ),
    ).rejects.toThrow('Safe unavailable');

    expect(createProposal.mock.invocationCallOrder[0]).toBeLessThan(
      propose.mock.invocationCallOrder[0]!,
    );
    expect(transaction.safePayoutIntent.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: intent.id,
          consumedAt: null,
          proposal: { is: null },
          payout: { status: PayoutStatus.PROPOSED },
        }),
      }),
    );
    expect(markSubmissionUnconfirmed).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: submitting.id, status: SafePayoutProposalStatus.SUBMITTING },
        data: expect.objectContaining({ failureReason: expect.stringContaining('Retry') }),
      }),
    );
    expect(transaction.safePayoutProposal.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a fresh payout submission when Safe has moved to another nonce', async () => {
    const safeAddress = getAddress('0x2222222222222222222222222222222222222222');
    const safeTxHash = `0x${'88'.repeat(32)}`;
    const payout = {
      id: 'payout-id',
      asset: FundingAsset.PRE,
      kind: PayoutKind.EXPENSE,
      amountRaw: '100',
      recipientAddress: '0x1111111111111111111111111111111111111111',
      status: PayoutStatus.PROPOSED,
    };
    const intent = {
      id: 'intent-id',
      payoutId: payout.id,
      goalId: 'goal-id',
      chainId: config.deployment.chainId,
      safeAddress: safeAddress.toLowerCase(),
      safeNonce: '7',
      toAddress: config.deployment.escrowAddress.toLowerCase(),
      valueRaw: '0',
      data: '0x1234',
      createdByAddress: actor.address,
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      consumedAt: null,
      proposal: null,
      payout,
    };
    const databaseTransaction = vi.fn();
    const prisma = {
      safePayoutIntent: { findUnique: vi.fn().mockResolvedValue(intent) },
      $transaction: databaseTransaction,
    } as unknown as PrismaService;
    const validateTransactionData = vi.fn();
    const propose = vi.fn();
    const safe = {
      assertPayoutReady: vi.fn().mockResolvedValue({
        address: safeAddress,
        threshold: 2,
        queueUrl: 'https://app.safe.global/transactions/queue?safe=basesep:test',
      }),
      nextNonce: vi.fn().mockResolvedValue(8),
      validateTransactionData,
      propose,
    } as unknown as SafeService;

    await expect(
      new AdminService(prisma, safe).submitSafePayoutProposal(
        intent.id,
        {
          transaction: {
            to: intent.toAddress,
            value: '0',
            data: intent.data,
            operation: OperationType.Call,
            safeTxGas: '0',
            baseGas: '0',
            gasPrice: '0',
            gasToken: '0x0000000000000000000000000000000000000000',
            refundReceiver: '0x0000000000000000000000000000000000000000',
            nonce: 7,
          },
          safeTxHash,
          senderAddress: actor.address,
          senderSignature: '0x1234',
        },
        actor,
      ),
    ).rejects.toThrow('The Safe nonce changed. Create a new payout request.');

    expect(validateTransactionData).not.toHaveBeenCalled();
    expect(databaseTransaction).not.toHaveBeenCalled();
    expect(propose).not.toHaveBeenCalled();
  });
});

describe('goal manager synchronization', () => {
  const safeAddress = getAddress('0x9999999999999999999999999999999999999999');
  const currentOwner = getAddress('0x1111111111111111111111111111111111111111');
  const legacyManager = getAddress('0x2222222222222222222222222222222222222222');
  const formerOwner = getAddress('0x3333333333333333333333333333333333333333');
  const manualManager = getAddress('0x4444444444444444444444444444444444444444');
  const queueUrl = 'https://app.safe.global/transactions/queue?safe=basesep:test';

  function safeInfo(overrides: Record<string, unknown> = {}) {
    return {
      address: safeAddress,
      owners: [currentOwner],
      threshold: 2,
      nonce: 7,
      escrowOwner: getAddress(actor.address),
      isEscrowOwner: false,
      pendingOwner: getAddress('0x0000000000000000000000000000000000000000'),
      isPendingEscrowOwner: false,
      queueUrl,
      ...overrides,
    };
  }

  it('merges Safe, manual and legacy sources and reports drift with open-goal counts', async () => {
    const assignments = [
      {
        address: currentOwner.toLowerCase(),
        source: GoalManagerAssignmentSource.SAFE_OWNER,
        desiredEnabled: true,
      },
      {
        address: formerOwner.toLowerCase(),
        source: GoalManagerAssignmentSource.SAFE_OWNER,
        desiredEnabled: false,
      },
      {
        address: manualManager.toLowerCase(),
        source: GoalManagerAssignmentSource.MANUAL,
        desiredEnabled: true,
      },
    ];
    const prisma = {
      chainAuthority: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            { address: legacyManager.toLowerCase() },
            { address: formerOwner.toLowerCase() },
          ]),
      },
      goalManagerAssignment: { findMany: vi.fn().mockResolvedValue(assignments) },
      safeGoalManagerProposal: { findFirst: vi.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;
    const safe = {
      configuredAddress: vi.fn().mockReturnValue(safeAddress),
      runtimeInfo: vi.fn().mockResolvedValue(safeInfo()),
      goalManagerMetrics: vi.fn().mockResolvedValue({
        maxOpenGoals: 3,
        entries: [
          { address: currentOwner, enabled: false, openGoalCount: 0 },
          { address: legacyManager, enabled: true, openGoalCount: 2 },
          { address: formerOwner, enabled: true, openGoalCount: 1 },
          { address: manualManager, enabled: false, openGoalCount: 0 },
        ],
      }),
    } as unknown as SafeService;

    const result = await new AdminService(prisma, safe).goalManagers(actor);

    expect(result.inSync).toBe(false);
    expect(result.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ address: currentOwner, safeOwner: true, status: 'NEEDS_ADD' }),
        expect.objectContaining({
          address: legacyManager,
          legacy: true,
          openGoalCount: 2,
          status: 'SYNCED',
        }),
        expect.objectContaining({ address: formerOwner, status: 'NEEDS_REMOVE' }),
        expect.objectContaining({
          address: manualManager,
          manualPinned: true,
          status: 'NEEDS_ADD',
        }),
      ]),
    );
  });

  it('rejects a removed Safe owner before changing desired manager policy', async () => {
    const upsert = vi.fn();
    const prisma = {
      goalManagerAssignment: { upsert },
      safeGoalManagerProposal: { updateMany: vi.fn() },
    } as unknown as PrismaService;
    const safe = {
      runtimeInfo: vi.fn().mockResolvedValue(
        safeInfo({
          escrowOwner: safeAddress,
          isEscrowOwner: true,
          owners: [currentOwner],
        }),
      ),
    } as unknown as SafeService;

    await expect(
      new AdminService(prisma, safe).updateGoalManager(manualManager, { enabled: true }, actor),
    ).rejects.toThrow('Only a current Safe owner can synchronize goal managers');

    expect(upsert).not.toHaveBeenCalled();
    expect(prisma.safeGoalManagerProposal.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a stale projected direct owner before changing desired manager policy', async () => {
    const upsert = vi.fn();
    const prisma = {
      goalManagerAssignment: { upsert },
      safeGoalManagerProposal: { updateMany: vi.fn() },
    } as unknown as PrismaService;
    const safe = {
      runtimeInfo: vi.fn().mockResolvedValue(
        safeInfo({
          escrowOwner: currentOwner,
          isEscrowOwner: false,
          owners: [],
        }),
      ),
    } as unknown as SafeService;

    await expect(
      new AdminService(prisma, safe).updateGoalManager(manualManager, { enabled: true }, actor),
    ).rejects.toThrow('Only the current direct escrow owner can synchronize goal managers');

    expect(upsert).not.toHaveBeenCalled();
    expect(prisma.safeGoalManagerProposal.updateMany).not.toHaveBeenCalled();
  });

  it('prepares one direct setGoalManager call per missing Safe owner before migration', async () => {
    const findAssignments = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          address: currentOwner.toLowerCase(),
          source: GoalManagerAssignmentSource.SAFE_OWNER,
          desiredEnabled: true,
        },
      ]);
    const prisma = {
      chainAuthority: { findMany: vi.fn().mockResolvedValue([]) },
      goalManagerAssignment: {
        findMany: findAssignments,
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        upsert: vi.fn().mockResolvedValue({}),
      },
    } as unknown as PrismaService;
    const safe = {
      runtimeInfo: vi.fn().mockResolvedValue(safeInfo()),
    } as unknown as SafeService;

    const result = await new AdminService(prisma, safe).prepareSafeGoalManagerSync(actor);

    expect(result.mode).toBe('DIRECT');
    if (result.mode !== 'DIRECT') throw new Error('Expected direct synchronization');
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0]).toMatchObject({
      chainId: config.deployment.chainId,
      to: getAddress(config.deployment.escrowAddress),
      operation: OperationType.Call,
    });
    expect(decodeFunctionData({ abi: escrowAbi, data: result.transactions[0]!.data })).toEqual({
      functionName: 'setGoalManager',
      args: [currentOwner, true],
    });
  });

  it('lets a current Safe owner remove only its manual pin, not its effective role', async () => {
    const afterUnpin = [
      {
        address: currentOwner.toLowerCase(),
        source: GoalManagerAssignmentSource.SAFE_OWNER,
        desiredEnabled: true,
      },
      {
        address: currentOwner.toLowerCase(),
        source: GoalManagerAssignmentSource.MANUAL,
        desiredEnabled: false,
      },
    ];
    const upsert = vi.fn().mockResolvedValue({});
    const updatePendingProposal = vi.fn().mockResolvedValue({ count: 0 });
    const prisma = {
      chainAuthority: {
        findMany: vi.fn().mockResolvedValue([{ address: currentOwner.toLowerCase() }]),
      },
      goalManagerAssignment: {
        findMany: vi.fn().mockResolvedValueOnce(afterUnpin).mockResolvedValueOnce(afterUnpin),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        upsert,
      },
      safeGoalManagerProposal: { updateMany: updatePendingProposal },
      project: { findUnique: vi.fn().mockResolvedValue({ id: 'project-id' }) },
      auditEvent: { create: vi.fn().mockResolvedValue({}) },
    } as unknown as PrismaService;
    const safe = { runtimeInfo: vi.fn().mockResolvedValue(safeInfo()) } as unknown as SafeService;

    const result = await new AdminService(prisma, safe).updateGoalManager(
      currentOwner,
      { enabled: false },
      actor,
    );

    expect(result).toEqual({ mode: 'NONE', changes: [] });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { desiredEnabled: false } }),
    );
    const pendingUpdate = updatePendingProposal.mock.calls[0]?.[0];
    expect(pendingUpdate?.data).toEqual(
      expect.objectContaining({ failureReason: expect.stringContaining('Cancel or replace') }),
    );
    expect(pendingUpdate?.data).not.toHaveProperty('status');
    expect(pendingUpdate?.data).not.toHaveProperty('activeKey');
  });

  it('rejects a Safe manager proposal signed by another wallet', async () => {
    const service = new AdminService({} as PrismaService, {} as SafeService);
    await expect(
      service.submitSafeGoalManagerIntent(
        '00000000-0000-4000-8000-000000000001',
        {
          transaction: {} as never,
          safeTxHash: `0x${'11'.repeat(32)}`,
          senderAddress: currentOwner,
          senderSignature: '0x1234',
        },
        actor,
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('retries a durable SUBMITTING goal manager proposal without reserving a new nonce', async () => {
    const safeTxHash = `0x${'99'.repeat(32)}`;
    const transactionData = {
      to: getAddress(config.deployment.escrowAddress),
      value: '0',
      data: '0x1234',
      operation: OperationType.Call,
      safeTxGas: '0',
      baseGas: '0',
      gasPrice: '0',
      gasToken: '0x0000000000000000000000000000000000000000',
      refundReceiver: '0x0000000000000000000000000000000000000000',
      nonce: 7,
    };
    const proposal = {
      id: 'proposal-id',
      intentId: '00000000-0000-4000-8000-000000000001',
      activeKey: `${config.deployment.chainId}:${safeAddress.toLowerCase()}`,
      safeTxHash,
      safeNonce: '7',
      senderAddress: actor.address.toLowerCase(),
      confirmations: 1,
      threshold: 2,
      status: SafeGoalManagerProposalStatus.SUBMITTING,
      executionTxHash: null,
      failureReason: 'Safe submission has not been confirmed. Retry the signed proposal.',
      lastCheckedAt: null,
      executedAt: null,
      createdAt: new Date('2026-08-15T12:00:00.000Z'),
      updatedAt: new Date('2026-08-15T12:00:00.000Z'),
    };
    const intent = {
      id: proposal.intentId,
      chainId: config.deployment.chainId,
      safeAddress: safeAddress.toLowerCase(),
      safeNonce: '7',
      changes: [{ address: currentOwner, enabled: true }],
      desiredStateHash: goalManagerStateHash([currentOwner]),
      expiresAt: new Date('2026-08-15T12:10:00.000Z'),
      proposal,
    };
    const submitted = {
      ...proposal,
      status: SafeGoalManagerProposalStatus.AWAITING_CONFIRMATIONS,
      failureReason: null,
      intent,
    };
    const databaseTransaction = vi.fn();
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      safeGoalManagerIntent: { findUnique: vi.fn().mockResolvedValue(intent) },
      safeGoalManagerProposal: {
        updateMany,
        findUniqueOrThrow: vi.fn().mockResolvedValue(submitted),
      },
      chainAuthority: { findMany: vi.fn().mockResolvedValue([]) },
      goalManagerAssignment: {
        findMany: vi.fn().mockResolvedValue([
          {
            address: currentOwner.toLowerCase(),
            source: GoalManagerAssignmentSource.SAFE_OWNER,
            desiredEnabled: true,
          },
        ]),
      },
      $transaction: databaseTransaction,
    } as unknown as PrismaService;
    const nextNonce = vi.fn();
    const propose = vi.fn().mockResolvedValue(undefined);
    const validateExactTransactionData = vi.fn();
    const safe = {
      assertPayoutReady: vi.fn().mockResolvedValue(
        safeInfo({
          escrowOwner: safeAddress,
          isEscrowOwner: true,
          owners: [currentOwner],
        }),
      ),
      nextNonce,
      createTransactionData: vi.fn().mockResolvedValue(transactionData),
      validateExactTransactionData,
      transactionHash: vi.fn().mockResolvedValue(safeTxHash),
      propose,
    } as unknown as SafeService;

    await expect(
      new AdminService(prisma, safe).submitSafeGoalManagerIntent(
        intent.id,
        {
          transaction: transactionData,
          safeTxHash,
          senderAddress: actor.address,
          senderSignature: '0x1234',
        },
        actor,
      ),
    ).resolves.toMatchObject({
      safeTxHash,
      status: SafeGoalManagerProposalStatus.AWAITING_CONFIRMATIONS,
      failureReason: null,
    });

    expect(nextNonce).not.toHaveBeenCalled();
    expect(databaseTransaction).not.toHaveBeenCalled();
    expect(validateExactTransactionData).toHaveBeenCalledWith(
      transactionData,
      transactionData,
      'goal manager synchronization',
    );
    expect(propose).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: proposal.id, status: SafeGoalManagerProposalStatus.SUBMITTING },
        data: expect.objectContaining({
          status: SafeGoalManagerProposalStatus.AWAITING_CONFIRMATIONS,
          failureReason: null,
        }),
      }),
    );
  });

  it('rejects an intent after part of its confirmed drift was already resolved', async () => {
    const intent = {
      id: '00000000-0000-4000-8000-000000000001',
      chainId: config.deployment.chainId,
      safeAddress: safeAddress.toLowerCase(),
      safeNonce: '7',
      changes: [
        { address: currentOwner, enabled: true },
        { address: formerOwner, enabled: false },
      ],
      desiredStateHash: goalManagerStateHash([currentOwner]),
      expiresAt: new Date(Date.now() + 60_000),
      proposal: null,
    };
    const prisma = {
      safeGoalManagerIntent: { findUnique: vi.fn().mockResolvedValue(intent) },
      chainAuthority: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            { address: currentOwner.toLowerCase() },
            { address: formerOwner.toLowerCase() },
          ]),
      },
      goalManagerAssignment: {
        findMany: vi.fn().mockResolvedValue([
          {
            address: currentOwner.toLowerCase(),
            source: GoalManagerAssignmentSource.SAFE_OWNER,
            desiredEnabled: true,
          },
          {
            address: formerOwner.toLowerCase(),
            source: GoalManagerAssignmentSource.SAFE_OWNER,
            desiredEnabled: false,
          },
        ]),
      },
    } as unknown as PrismaService;
    const createTransactionData = vi.fn();
    const safe = {
      assertPayoutReady: vi
        .fn()
        .mockResolvedValue(safeInfo({ escrowOwner: safeAddress, isEscrowOwner: true })),
      createTransactionData,
    } as unknown as SafeService;

    await expect(
      new AdminService(prisma, safe).submitSafeGoalManagerIntent(
        intent.id,
        {
          transaction: {} as never,
          safeTxHash: `0x${'11'.repeat(32)}`,
          senderAddress: actor.address,
          senderSignature: '0x1234',
        },
        actor,
      ),
    ).rejects.toThrow('Confirmed goal manager state changed');
    expect(createTransactionData).not.toHaveBeenCalled();
  });
});
