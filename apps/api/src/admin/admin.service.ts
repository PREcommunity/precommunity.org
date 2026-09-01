import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  ChainAuthorityKind,
  CommunityProposalStatus,
  ExpenseCadence,
  ExpenseStatus,
  FundingAsset,
  FundingGoalType,
  FundingGoalStatus,
  MonthlySurplusPolicy,
  PayoutKind,
  PayoutStatus,
  Prisma,
  GoalManagerAssignmentSource,
  Role,
  SafeGoalActionKind,
  SafeGoalActionProposalStatus,
  SafeGoalManagerProposalStatus,
  SafePayoutDelivery,
  SafePayoutProposalStatus,
  desiredGoalManagerSet,
  expireUnconsumedSafePayoutIntents,
  reconcileSafeOwnerGoalManagerAssignments,
} from '@precommunity/database';
import {
  DEFAULT_SUBPROJECT_SLUG,
  MAX_FIRST_SETTLEMENT_DELAY_MS,
  MIN_FIRST_SETTLEMENT_DELAY_MS,
  PRECOMMUNITY_ESCROW_ABI,
  PROJECT_SLUG,
  canonicalGoalMetadata,
  isDeploymentConfigured,
  isUtcMidnight,
  isValidIpfsUri,
  safeWalletQueueUrl,
} from '@precommunity/shared';
import {
  encodeFunctionData,
  getAddress,
  isAddress,
  isAddressEqual,
  keccak256,
  parseUnits,
  toHex,
} from 'viem';
import { OperationType, type SafeTransactionData } from '@safe-global/types-kit';
import type { AuthenticatedPrincipal } from '../common/request-context';
import { writeAuditEvent } from '../common/audit';
import { GoalManagerSyncQueue } from './goal-manager-sync-queue.service';
import { deploymentTransactionRequest } from '../common/deployment-transaction';
import { PrismaService } from '../common/prisma.service';
import { config } from '../config';
import { SafeService, type SafeRuntimeInfo } from '../safe/safe.service';
import type {
  SubmitSafePayoutProposalDto,
  SubmitSafeTransactionProposalDto,
} from '../safe/safe.dto';
import {
  AssignRolesDto,
  ChainSubmissionDto,
  CreateExpenseDto,
  CreateSubprojectDto,
  FundingTargetDto,
  ModerateProfileDto,
  PrepareGoalLifecycleDto,
  PrepareSafeDeliveryDto,
  ReleaseProposalDto,
  type SafeDelivery,
  UpdateGoalManagerDto,
  UpdateExpenseDto,
} from './admin.dto';

export const escrowAbi = PRECOMMUNITY_ESCROW_ABI;

class SafePayoutIntentClaimError extends Error {}

class SafeGoalManagerIntentClaimError extends Error {}

class SafeGoalActionIntentClaimError extends Error {}

const pendingGoalManagerProposalStatuses: SafeGoalManagerProposalStatus[] = [
  SafeGoalManagerProposalStatus.SUBMITTING,
  SafeGoalManagerProposalStatus.AWAITING_CONFIRMATIONS,
  SafeGoalManagerProposalStatus.READY_TO_EXECUTE,
];
const pendingGoalActionProposalStatuses: SafeGoalActionProposalStatus[] = [
  SafeGoalActionProposalStatus.SUBMITTING,
  SafeGoalActionProposalStatus.AWAITING_CONFIRMATIONS,
  SafeGoalActionProposalStatus.READY_TO_EXECUTE,
];
const pendingPayoutProposalStatuses: SafePayoutProposalStatus[] = [
  SafePayoutProposalStatus.SUBMITTING,
  SafePayoutProposalStatus.AWAITING_CONFIRMATIONS,
  SafePayoutProposalStatus.READY_TO_EXECUTE,
];
const zeroAddress = '0x0000000000000000000000000000000000000000';

function safeDelivery(value?: SafeDelivery) {
  return value ?? 'SERVICE';
}

function encodeGoalLifecycleData(
  chainGoalId: string,
  kind: SafeGoalActionKind,
  monthlySurplusPolicy?: MonthlySurplusPolicy,
) {
  const goalId = chainGoalId as `0x${string}`;
  if (kind === SafeGoalActionKind.SET_MONTHLY_SURPLUS_POLICY) {
    if (!monthlySurplusPolicy) throw new BadRequestException('Monthly surplus policy is required');
    return encodeFunctionData({
      abi: escrowAbi,
      functionName: 'setMonthlySurplusPolicy',
      args: [goalId, monthlyPolicyValue(monthlySurplusPolicy)],
    });
  }
  if (kind === SafeGoalActionKind.REQUEST_MONTHLY_STOP) {
    return encodeFunctionData({
      abi: escrowAbi,
      functionName: 'requestMonthlyGoalStop',
      args: [goalId],
    });
  }
  if (kind === SafeGoalActionKind.CANCEL_MONTHLY) {
    return encodeFunctionData({
      abi: escrowAbi,
      functionName: 'cancelMonthlyGoal',
      args: [goalId],
    });
  }
  throw new BadRequestException('Unsupported monthly lifecycle action');
}

type GoalManagerChange = { address: string; enabled: boolean };

export function normalizedGoalManagerChanges(changes: GoalManagerChange[]) {
  return [...changes]
    .map((change) => ({
      address: getAddress(change.address).toLowerCase(),
      enabled: change.enabled,
    }))
    .sort((left, right) => left.address.localeCompare(right.address));
}

export function goalManagerStateHash(addresses: Iterable<string>) {
  const normalized = [...new Set([...addresses].map((address) => address.toLowerCase()))].sort();
  return keccak256(toHex(JSON.stringify(normalized)));
}

function sameGoalManagerChanges(left: GoalManagerChange[], right: GoalManagerChange[]) {
  return (
    JSON.stringify(normalizedGoalManagerChanges(left)) ===
    JSON.stringify(normalizedGoalManagerChanges(right))
  );
}

function goalManagerCall(change: GoalManagerChange) {
  return {
    chainId: config.deployment.chainId,
    to: getAddress(config.deployment.escrowAddress),
    value: '0',
    data: encodeFunctionData({
      abi: escrowAbi,
      functionName: 'setGoalManager',
      args: [getAddress(change.address), change.enabled],
    }),
    operation: OperationType.Call,
  };
}

function deploymentAddress() {
  if (!isDeploymentConfigured(config.deployment)) {
    throw new ServiceUnavailableException(
      `The ${config.deployment.networkName} deployment manifest is not configured yet`,
    );
  }
  return getAddress(config.deployment.escrowAddress);
}

export function encodeCreateGoalData(goal: {
  chainGoalId: string;
  recipientAddress: string;
  preTargetRaw: string;
  usdcTargetRaw: string;
  deadline: Date;
  title: string;
  description: string;
  metadataUri: string | null;
}) {
  return encodeFunctionData({
    abi: escrowAbi,
    functionName: 'createGoal',
    args: [
      goal.chainGoalId as `0x${string}`,
      getAddress(goal.recipientAddress),
      BigInt(goal.preTargetRaw),
      BigInt(goal.usdcTargetRaw),
      BigInt(Math.floor(goal.deadline.getTime() / 1000)),
      goal.title,
      goal.description,
      goal.metadataUri ?? '',
    ],
  });
}

function monthlyPolicyValue(policy: MonthlySurplusPolicy) {
  return policy === MonthlySurplusPolicy.PAYOUT_ALL ? 0 : 1;
}

export function encodeCreateMonthlyGoalData(goal: {
  chainGoalId: string;
  recipientAddress: string;
  preTargetRaw: string;
  usdcTargetRaw: string;
  firstSettlementAt: Date | null;
  monthlySurplusPolicy: MonthlySurplusPolicy;
  title: string;
  description: string;
  metadataUri: string | null;
}) {
  return encodeFunctionData({
    abi: escrowAbi,
    functionName: 'createMonthlyGoal',
    args: [
      goal.chainGoalId as `0x${string}`,
      getAddress(goal.recipientAddress),
      BigInt(goal.preTargetRaw),
      BigInt(goal.usdcTargetRaw),
      goal.firstSettlementAt ? BigInt(Math.floor(goal.firstSettlementAt.getTime() / 1000)) : 0n,
      monthlyPolicyValue(goal.monthlySurplusPolicy),
      goal.title,
      goal.description,
      goal.metadataUri ?? '',
    ],
  });
}

const targetRules: Record<FundingAsset, { decimals: number; maxRaw: bigint }> = {
  [FundingAsset.PRE]: { decimals: 18, maxRaw: 2n ** 256n - 1n },
  [FundingAsset.USDC]: { decimals: 6, maxRaw: 2n ** 256n - 1n },
};

export function parseFundingTarget(asset: FundingAsset, amount: string) {
  const rule = targetRules[asset];
  const fraction = amount.split('.')[1] ?? '';
  if (fraction.length > rule.decimals)
    throw new BadRequestException(`${asset} supports at most ${rule.decimals} decimal places`);
  try {
    const raw = parseUnits(amount, rule.decimals);
    if (raw > rule.maxRaw) throw new Error('out of range');
    return raw;
  } catch {
    throw new BadRequestException(`${asset} funding target is out of range`);
  }
}

function validateFundingTargets(targets: FundingTargetDto[]) {
  if (new Set(targets.map((target) => target.asset)).size !== targets.length) {
    throw new BadRequestException('Funding target assets must be unique');
  }
  const parsed = targets.map((target) => parseFundingTarget(target.asset, target.amount));
  if (!parsed.some((amount) => amount > 0n))
    throw new BadRequestException('At least one funding target must be greater than zero');
}

function validateCoreGoal(input: {
  title: string;
  description: string;
  deadline?: Date | null;
  metadataUri: string | null;
}) {
  const titleBytes = Buffer.byteLength(input.title, 'utf8');
  const descriptionBytes = Buffer.byteLength(input.description, 'utf8');
  if (titleBytes === 0 || titleBytes > 96)
    throw new BadRequestException('Title must use 1–96 UTF-8 bytes');
  if (descriptionBytes > 512)
    throw new BadRequestException('Description must use at most 512 UTF-8 bytes');
  if (input.deadline && input.deadline.getTime() <= Date.now())
    throw new BadRequestException('Deadline must be in the future');
  if (input.metadataUri && !isValidIpfsUri(input.metadataUri))
    throw new BadRequestException('Metadata URI must contain a valid IPFS CID');
}

function parseFirstSettlementAt(value: string | null | undefined) {
  if (value === null || value === undefined) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new BadRequestException('First settlement must be a valid date');
  }
  return date;
}

function monthlyScheduleAudit(firstSettlementAtOverride: Date | null) {
  return {
    mode: firstSettlementAtOverride ? ('CUSTOM' as const) : ('DEFAULT' as const),
    firstSettlementAt: firstSettlementAtOverride?.toISOString() ?? null,
  };
}

function validateCadence(
  cadence: ExpenseCadence,
  deadline: Date | null,
  monthlySurplusPolicy: MonthlySurplusPolicy | null,
  firstSettlementAtOverride: Date | null,
  now = new Date(),
) {
  if (cadence === ExpenseCadence.ONE_TIME) {
    if (!deadline) throw new BadRequestException('A one-time goal requires a deadline');
    if (monthlySurplusPolicy)
      throw new BadRequestException('A one-time goal cannot define a monthly surplus policy');
    if (firstSettlementAtOverride)
      throw new BadRequestException('A one-time goal cannot define a first settlement date');
    return;
  }
  if (deadline) throw new BadRequestException('A monthly goal cannot define a deadline');
  if (!monthlySurplusPolicy)
    throw new BadRequestException('A monthly goal requires an explicit surplus policy');
  if (!firstSettlementAtOverride) return;
  if (!isUtcMidnight(firstSettlementAtOverride)) {
    throw new BadRequestException('First settlement must be at 00:00 UTC');
  }
  const delay = firstSettlementAtOverride.getTime() - now.getTime();
  if (delay < MIN_FIRST_SETTLEMENT_DELAY_MS || delay > MAX_FIRST_SETTLEMENT_DELAY_MS) {
    throw new BadRequestException('First settlement must be between 7 and 60 days from now');
  }
}

interface FundingAggregate {
  fundedRaw: string;
  expenseReleasedRaw: string;
  cancelledFundsReleasedRaw: string;
}

type FundingAggregates = Record<FundingAsset, FundingAggregate>;
type ContributionAggregateRow = { goalId: string; asset: FundingAsset; amountRaw: string };
type PayoutAggregateRow = {
  goalId: string;
  asset: FundingAsset;
  kind: PayoutKind;
  amountRaw: string;
};

function emptyFundingAggregates(): FundingAggregates {
  return {
    [FundingAsset.PRE]: {
      fundedRaw: '0',
      expenseReleasedRaw: '0',
      cancelledFundsReleasedRaw: '0',
    },
    [FundingAsset.USDC]: {
      fundedRaw: '0',
      expenseReleasedRaw: '0',
      cancelledFundsReleasedRaw: '0',
    },
  };
}

@Injectable()
export class AdminService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Optional() @Inject(SafeService) private readonly safe?: SafeService,
    @Optional()
    @Inject(GoalManagerSyncQueue)
    private readonly goalManagerSyncQueue?: GoalManagerSyncQueue,
  ) {}

  private safeClient() {
    if (!this.safe) throw new ServiceUnavailableException('Safe integration is unavailable');
    return this.safe;
  }

  private manualSafeExport(
    info: Pick<SafeRuntimeInfo, 'address' | 'queueUrl'>,
    name: string,
    description: string,
    transactions: Array<{
      to: string;
      value: string;
      data: string;
      operation?: OperationType;
    }>,
  ) {
    const calls = transactions.map((transaction) => {
      if (transaction.operation !== undefined && transaction.operation !== OperationType.Call) {
        throw new ForbiddenException('Manual Safe exports cannot contain DelegateCall');
      }
      return {
        chainId: config.deployment.chainId,
        to: getAddress(transaction.to),
        value: transaction.value,
        data: transaction.data as `0x${string}`,
        operation: OperationType.Call,
      };
    });
    const first = calls[0];
    if (!first) throw new BadRequestException('A manual Safe export requires a transaction');
    return {
      mode: 'MANUAL' as const,
      name,
      description,
      chainId: config.deployment.chainId,
      safeAddress: info.address,
      queueUrl: info.queueUrl,
      transactions: calls,
      transactionRequest: {
        chainId: first.chainId,
        to: first.to,
        value: first.value,
        data: first.data,
      },
    };
  }

  private assertManualReplacementAllowed(
    proposal: { status: string; failureReason: string | null },
    confirmedAbsentFromSafe?: boolean,
  ) {
    if (proposal.status === 'AWAITING_CONFIRMATIONS' || proposal.status === 'READY_TO_EXECUTE') {
      throw new BadRequestException(
        'A Safe proposal is already awaiting signatures or ready to execute and cannot be duplicated.',
      );
    }
    if (proposal.status !== 'SUBMITTING') return;
    if (!proposal.failureReason) {
      throw new BadRequestException('A Safe proposal is still being submitted. Try again later.');
    }
    if (!confirmedAbsentFromSafe) {
      throw new BadRequestException(
        'CONFIRM_SAFE_QUEUE_ABSENT: Check the Safe queue and confirm that this proposal is absent before exporting a manual replacement.',
      );
    }
  }

  private manualPayoutResponse(
    info: Pick<SafeRuntimeInfo, 'address' | 'queueUrl'>,
    intent: {
      id: string;
      toAddress: string;
      valueRaw: string;
      data: string;
      payout: { asset: FundingAsset; kind: PayoutKind; amountRaw: string };
    },
    goalTitle: string,
  ) {
    return {
      ...this.manualSafeExport(
        info,
        `Payout: ${goalTitle}`,
        `${intent.payout.kind} payout of ${intent.payout.amountRaw} ${intent.payout.asset} for ${goalTitle}.`,
        [
          {
            to: intent.toAddress,
            value: intent.valueRaw,
            data: intent.data,
          },
        ],
      ),
      id: intent.id,
      reservationId: intent.id,
      delivery: 'MANUAL' as const,
    };
  }

  private isMissingDatabaseColumn(error: unknown) {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2022';
  }

  private isUniqueConstraint(error: unknown) {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }

  private canDirectlyControlGoal(goal: { creatorAddress: string }, actor: AuthenticatedPrincipal) {
    const actorAddress = actor.address.toLowerCase();
    const isDirectOwner =
      actor.chainAuthorities.includes(ChainAuthorityKind.OWNER) &&
      actor.chainOwnerAddress?.toLowerCase() === actorAddress;
    const isCreatingManager =
      actor.chainAuthorities.includes(ChainAuthorityKind.GOAL_MANAGER) &&
      goal.creatorAddress.toLowerCase() === actorAddress;
    return isDirectOwner || isCreatingManager;
  }

  private assertCanPublishGoal(actor: AuthenticatedPrincipal) {
    const actorAddress = actor.address.toLowerCase();
    const isDirectOwner =
      actor.chainAuthorities.includes(ChainAuthorityKind.OWNER) &&
      actor.chainOwnerAddress?.toLowerCase() === actorAddress;
    if (!isDirectOwner && !actor.chainAuthorities.includes(ChainAuthorityKind.GOAL_MANAGER)) {
      throw new ForbiddenException(
        'Only the confirmed escrow owner or a confirmed goal manager can publish a goal',
      );
    }
  }

  private assertDirectGoalController(
    goal: { creatorAddress: string },
    actor: AuthenticatedPrincipal,
  ) {
    if (!this.canDirectlyControlGoal(goal, actor)) {
      throw new ForbiddenException(
        'Only the direct escrow owner or the confirmed goal manager that created this goal can control it',
      );
    }
  }

  private async project() {
    const project = await this.prisma.project.findUnique({ where: { slug: PROJECT_SLUG } });
    if (!project)
      throw new NotFoundException(
        'The precommunity project is not configured; run the database seed once',
      );
    return project;
  }

  async list() {
    const project = await this.project();
    const findWorkspace = () =>
      this.prisma.subproject.findMany({
        where: { projectId: project.id },
        include: {
          expenses: {
            include: {
              targets: true,
              goals: {
                where: {
                  chainId: config.deployment.chainId,
                  creationTxHash: { not: null },
                },
                orderBy: { creationBlock: 'desc' },
                take: 1,
                select: {
                  id: true,
                  creatorAddress: true,
                  status: true,
                  goalType: true,
                  monthlySurplusPolicy: true,
                  monthlyFirstSettlementAt: true,
                  monthlySettlementDay: true,
                  monthlyStopRequestedAt: true,
                  monthlyPeriodsSettled: true,
                  deadline: true,
                  preTargetRaw: true,
                  usdcTargetRaw: true,
                  preRecipientEntitlementRaw: true,
                  usdcRecipientEntitlementRaw: true,
                  preCarryRaw: true,
                  usdcCarryRaw: true,
                  preTreasuryEntitlementRaw: true,
                  usdcTreasuryEntitlementRaw: true,
                  periods: {
                    orderBy: { periodIndex: 'desc' },
                    take: 1,
                  },
                },
              },
            },
          },
        },
        orderBy: { name: 'asc' },
      });
    let workspace: Awaited<ReturnType<typeof findWorkspace>>;
    try {
      workspace = await findWorkspace();
    } catch (error) {
      if (this.isMissingDatabaseColumn(error)) {
        throw new ServiceUnavailableException(
          'Database schema is outdated; run `pnpm db:migrate` and restart the API and worker services',
        );
      }
      throw error;
    }

    const goalIds = workspace.flatMap((subproject) =>
      subproject.expenses.flatMap((expense) => expense.goals.map((goal) => goal.id)),
    );
    let contributions: ContributionAggregateRow[] = [];
    let payouts: PayoutAggregateRow[] = [];
    if (goalIds.length) {
      const goalIdFilter = Prisma.sql`ARRAY[${Prisma.join(goalIds)}]::uuid[]`;
      [contributions, payouts] = await Promise.all([
        this.prisma.$queryRaw<ContributionAggregateRow[]>(Prisma.sql`
          SELECT "goalId", "asset", SUM("amountRaw"::numeric)::text AS "amountRaw"
          FROM "CryptoContribution"
          WHERE "goalId" = ANY(${goalIdFilter})
          GROUP BY "goalId", "asset"
        `),
        this.prisma.$queryRaw<PayoutAggregateRow[]>(Prisma.sql`
          SELECT "goalId", "asset", "kind", SUM("amountRaw"::numeric)::text AS "amountRaw"
          FROM "Payout"
          WHERE "goalId" = ANY(${goalIdFilter})
            AND "status" = ${PayoutStatus.EXECUTED}::"PayoutStatus"
          GROUP BY "goalId", "asset", "kind"
        `),
      ]);
    }
    const aggregates = new Map(goalIds.map((id) => [id, emptyFundingAggregates()]));
    for (const row of contributions)
      aggregates.get(row.goalId)![row.asset].fundedRaw = row.amountRaw;
    for (const row of payouts) {
      const aggregate = aggregates.get(row.goalId)![row.asset];
      if (row.kind === PayoutKind.EXPENSE) aggregate.expenseReleasedRaw = row.amountRaw;
      else aggregate.cancelledFundsReleasedRaw = row.amountRaw;
    }

    return workspace.map((subproject) => ({
      ...subproject,
      expenses: subproject.expenses.map((expense) => ({
        ...expense,
        goals: expense.goals.map((goal) => ({ ...goal, fundingTotals: aggregates.get(goal.id)! })),
      })),
    }));
  }

  private async resolveSubproject(
    database: Pick<Prisma.TransactionClient, 'subproject'>,
    projectId: string,
    subprojectId?: string | null,
  ) {
    const subproject = await database.subproject.findFirst({
      where: subprojectId
        ? { id: subprojectId, projectId, archivedAt: null }
        : { projectId, slug: DEFAULT_SUBPROJECT_SLUG, archivedAt: null },
    });
    if (subproject) return subproject;
    if (subprojectId) throw new BadRequestException('Subproject not found for this project');
    throw new ServiceUnavailableException(
      'The default General subproject is not configured; run the database seed once',
    );
  }

  async createSubproject(dto: CreateSubprojectDto, actor: AuthenticatedPrincipal) {
    const project = await this.project();
    if (dto.slug === DEFAULT_SUBPROJECT_SLUG)
      throw new BadRequestException('General is a reserved system subproject');
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.subproject.create({ data: { projectId: project.id, ...dto } });
      await writeAuditEvent(tx, {
        projectId: project.id,
        actor,
        entityType: 'Subproject',
        entityId: created.id,
        action: 'CREATE',
        after: { name: created.name, slug: created.slug },
      });
      return created;
    });
  }

  async createExpense(
    dto: CreateExpenseDto,
    actor: AuthenticatedPrincipal,
    communityProposalId?: string,
  ) {
    const project = await this.project();
    validateFundingTargets(dto.targets);
    const deadline = dto.deadline ? new Date(dto.deadline) : null;
    const monthlySurplusPolicy = dto.monthlySurplusPolicy ?? null;
    if (dto.cadence === ExpenseCadence.ONE_TIME && dto.firstSettlementAt !== undefined) {
      throw new BadRequestException('A one-time goal cannot define a first settlement date');
    }
    const firstSettlementAtOverride = parseFirstSettlementAt(dto.firstSettlementAt);
    validateCadence(dto.cadence, deadline, monthlySurplusPolicy, firstSettlementAtOverride);
    validateCoreGoal({
      title: dto.name,
      description: dto.purpose,
      deadline,
      metadataUri: dto.metadataUri ?? null,
    });
    const created = await this.prisma.$transaction(async (tx) => {
      if (communityProposalId) {
        const proposal = await tx.communityProposal.findUnique({
          where: { id: communityProposalId },
          include: { convertedExpense: true },
        });
        if (!proposal) throw new NotFoundException('Community proposal not found');
        if (proposal.status !== CommunityProposalStatus.PASSED)
          throw new BadRequestException('Only a passed community proposal can become a goal draft');
        if (proposal.convertedExpense)
          throw new BadRequestException('This proposal already has a goal draft');
      }
      const subproject = await this.resolveSubproject(tx, project.id, dto.subprojectId);
      const expense = await tx.expense.create({
        data: {
          subprojectId: subproject.id,
          communityProposalId,
          name: dto.name,
          slug: dto.slug,
          description: dto.description,
          purpose: dto.purpose,
          category: dto.category ?? null,
          cadence: dto.cadence,
          monthlySurplusPolicy,
          firstSettlementAtOverride,
          recipientAddress: getAddress(dto.recipientAddress).toLowerCase(),
          deadline,
          discussionUrl: dto.discussionUrl ?? null,
          metadataUri: dto.metadataUri,
          metadataDocuments: (dto.documents ?? []) as unknown as Prisma.InputJsonValue,
          targets: {
            create: dto.targets.map((target) => ({ asset: target.asset, amount: target.amount })),
          },
        },
        include: { targets: true, subproject: true },
      });
      if (communityProposalId) {
        await tx.communityProposal.update({
          where: { id: communityProposalId },
          data: {
            status: CommunityProposalStatus.CONVERTED,
            moderatedBy: actor.address,
            closedAt: new Date(),
          },
        });
      }
      await writeAuditEvent(tx, {
        projectId: project.id,
        actor,
        entityType: 'GoalDraft',
        entityId: expense.id,
        action: 'CREATE',
        after: {
          title: expense.name,
          slug: expense.slug,
          monthlySchedule:
            expense.cadence === ExpenseCadence.MONTHLY
              ? monthlyScheduleAudit(expense.firstSettlementAtOverride)
              : null,
        },
      });
      return expense;
    });
    return {
      ...created,
      canonicalMetadata: canonicalGoalMetadata({
        category: created.category ?? undefined,
        subproject: { name: created.subproject.name, slug: created.subproject.slug },
        discussionUrl: created.discussionUrl ?? undefined,
        documents: dto.documents,
      }),
    };
  }

  async updateExpense(id: string, dto: UpdateExpenseDto, actor: AuthenticatedPrincipal) {
    const project = await this.project();
    const before = await this.prisma.expense.findUnique({
      where: { id },
      include: { targets: true },
    });
    if (!before) throw new NotFoundException('Goal draft not found');
    if (before.status !== ExpenseStatus.DRAFT)
      throw new BadRequestException('Only an unpublished draft can be edited');
    if (dto.targets) validateFundingTargets(dto.targets);
    const cadence = dto.cadence ?? before.cadence;
    const deadline =
      dto.deadline === undefined ? before.deadline : dto.deadline ? new Date(dto.deadline) : null;
    const monthlySurplusPolicy =
      dto.monthlySurplusPolicy === undefined
        ? before.monthlySurplusPolicy
        : dto.monthlySurplusPolicy;
    const firstSettlementAtOverride =
      dto.firstSettlementAt === undefined
        ? before.firstSettlementAtOverride
        : parseFirstSettlementAt(dto.firstSettlementAt);
    validateCadence(cadence, deadline, monthlySurplusPolicy, firstSettlementAtOverride);
    validateCoreGoal({
      title: dto.name ?? before.name,
      description: dto.purpose ?? before.purpose,
      deadline,
      metadataUri: dto.metadataUri === undefined ? before.metadataUri : dto.metadataUri,
    });
    const updated = await this.prisma.$transaction(async (tx) => {
      const subproject =
        dto.subprojectId === undefined
          ? null
          : await this.resolveSubproject(tx, project.id, dto.subprojectId);
      if (dto.targets) await tx.fundingTarget.deleteMany({ where: { expenseId: id } });
      const expense = await tx.expense.update({
        where: { id },
        data: {
          subprojectId: subproject?.id,
          name: dto.name,
          slug: dto.slug,
          description: dto.description,
          purpose: dto.purpose,
          category: dto.category,
          cadence: dto.cadence,
          recipientAddress: dto.recipientAddress
            ? getAddress(dto.recipientAddress).toLowerCase()
            : undefined,
          deadline: dto.deadline === undefined ? undefined : deadline,
          monthlySurplusPolicy: dto.monthlySurplusPolicy,
          firstSettlementAtOverride:
            dto.firstSettlementAt === undefined ? undefined : firstSettlementAtOverride,
          discussionUrl: dto.discussionUrl,
          metadataUri: dto.metadataUri,
          metadataDocuments: dto.documents
            ? (dto.documents as unknown as Prisma.InputJsonValue)
            : undefined,
          targets: dto.targets
            ? {
                create: dto.targets.map((target) => ({
                  asset: target.asset,
                  amount: target.amount,
                })),
              }
            : undefined,
        },
        include: { targets: true },
      });
      await writeAuditEvent(tx, {
        projectId: project.id,
        actor,
        entityType: 'GoalDraft',
        entityId: id,
        action: 'UPDATE',
        before: {
          title: before.name,
          monthlySchedule:
            before.cadence === ExpenseCadence.MONTHLY
              ? monthlyScheduleAudit(before.firstSettlementAtOverride)
              : null,
        },
        after: {
          title: expense.name,
          monthlySchedule:
            expense.cadence === ExpenseCadence.MONTHLY
              ? monthlyScheduleAudit(expense.firstSettlementAtOverride)
              : null,
        },
      });
      return expense;
    });
    return updated;
  }

  async archiveExpense(id: string, actor: AuthenticatedPrincipal) {
    const project = await this.project();
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.expense.update({
        where: { id },
        data: { status: ExpenseStatus.ARCHIVED, archivedAt: new Date() },
      });
      await writeAuditEvent(tx, {
        projectId: project.id,
        actor,
        entityType: 'GoalDraft',
        entityId: id,
        action: 'ARCHIVE',
      });
      return updated;
    });
  }

  async publishExpense(id: string, actor: AuthenticatedPrincipal) {
    this.assertCanPublishGoal(actor);
    const to = deploymentAddress();
    const project = await this.project();
    const draft = await this.prisma.expense.findUnique({
      where: { id },
      include: { targets: true },
    });
    if (!draft) throw new NotFoundException('Goal draft not found');
    if (draft.status !== ExpenseStatus.DRAFT && draft.status !== ExpenseStatus.PENDING_CHAIN)
      throw new BadRequestException('This draft is already published');
    validateCadence(
      draft.cadence,
      draft.deadline,
      draft.monthlySurplusPolicy,
      draft.firstSettlementAtOverride,
    );
    validateFundingTargets(
      draft.targets.map((target) => ({ asset: target.asset, amount: target.amount.toString() })),
    );
    validateCoreGoal({
      title: draft.name,
      description: draft.purpose,
      deadline: draft.deadline,
      metadataUri: draft.metadataUri,
    });

    const pre =
      draft.targets.find((target) => target.asset === FundingAsset.PRE)?.amount.toString() ?? '0';
    const usdc =
      draft.targets.find((target) => target.asset === FundingAsset.USDC)?.amount.toString() ?? '0';
    const chainGoalId =
      draft.pendingChainGoalId ?? keccak256(toHex(`precommunity:escrow:${draft.id}`));
    const requestGoal = {
      chainGoalId,
      recipientAddress: draft.recipientAddress,
      preTargetRaw: parseFundingTarget(FundingAsset.PRE, pre).toString(),
      usdcTargetRaw: parseFundingTarget(FundingAsset.USDC, usdc).toString(),
      title: draft.name,
      description: draft.purpose,
      metadataUri: draft.metadataUri,
    };
    const pending = await this.prisma.$transaction(async (tx) => {
      const prepared = await tx.expense.update({
        where: { id },
        data: { pendingChainGoalId: chainGoalId },
      });
      await writeAuditEvent(tx, {
        projectId: project.id,
        actor,
        entityType: 'GoalDraft',
        entityId: id,
        action: 'PREPARE_CHAIN_PUBLICATION',
        after: {
          chainGoalId,
          monthlySchedule:
            draft.cadence === ExpenseCadence.MONTHLY
              ? monthlyScheduleAudit(draft.firstSettlementAtOverride)
              : null,
        },
      });
      return prepared;
    });
    return {
      draft: pending,
      transactionRequest: deploymentTransactionRequest({
        to,
        value: '0',
        data:
          draft.cadence === ExpenseCadence.MONTHLY
            ? encodeCreateMonthlyGoalData({
                ...requestGoal,
                firstSettlementAt: draft.firstSettlementAtOverride,
                monthlySurplusPolicy: draft.monthlySurplusPolicy!,
              })
            : encodeCreateGoalData({ ...requestGoal, deadline: draft.deadline! }),
      }),
    };
  }

  async markExpenseSubmitted(id: string, dto: ChainSubmissionDto, actor: AuthenticatedPrincipal) {
    const project = await this.project();
    return this.prisma.$transaction(async (tx) => {
      const draft = await tx.expense.findUnique({ where: { id } });
      if (!draft) throw new NotFoundException('Goal draft not found');
      if (draft.status === ExpenseStatus.PUBLISHED) return draft;
      if (
        !draft.pendingChainGoalId ||
        (draft.status !== ExpenseStatus.DRAFT && draft.status !== ExpenseStatus.PENDING_CHAIN)
      ) {
        throw new BadRequestException('The goal publication has not been prepared');
      }
      const updated = await tx.expense.update({
        where: { id },
        data: { status: ExpenseStatus.PENDING_CHAIN, pendingChainTxHash: dto.txHash.toLowerCase() },
      });
      await writeAuditEvent(tx, {
        projectId: project.id,
        actor,
        entityType: 'GoalDraft',
        entityId: id,
        action: 'CHAIN_PUBLICATION_SUBMITTED',
        after: { chainGoalId: draft.pendingChainGoalId, txHash: dto.txHash.toLowerCase() },
      });
      return updated;
    });
  }

  async closeProposal(goalId: string, actor: AuthenticatedPrincipal) {
    const to = deploymentAddress();
    const project = await this.project();
    const goal = await this.prisma.fundingGoal.findUnique({
      where: { id: goalId, chainId: config.deployment.chainId },
    });
    if (!goal) throw new NotFoundException('On-chain goal not found');
    if (goal.status !== FundingGoalStatus.OPEN)
      throw new BadRequestException('Only an open goal can be closed');
    if (goal.goalType !== FundingGoalType.ONE_TIME)
      throw new BadRequestException('Monthly goals use graceful stop instead of closeGoal');
    this.assertDirectGoalController(goal, actor);
    await writeAuditEvent(this.prisma, {
      projectId: project.id,
      actor,
      entityType: 'FundingGoal',
      entityId: goalId,
      action: 'PREPARE_CLOSE',
      after: { recipientEntitlement: 'ALL_CONFIRMED_CONTRIBUTIONS' },
    });
    return {
      transactionRequest: deploymentTransactionRequest({
        to,
        value: '0',
        data: encodeFunctionData({
          abi: escrowAbi,
          functionName: 'closeGoal',
          args: [goal.chainGoalId as `0x${string}`],
        }),
      }),
    };
  }

  async cancelProposal(goalId: string, actor: AuthenticatedPrincipal) {
    const to = deploymentAddress();
    const project = await this.project();
    const goal = await this.prisma.fundingGoal.findUnique({
      where: { id: goalId, chainId: config.deployment.chainId },
    });
    if (!goal) throw new NotFoundException('On-chain goal not found');
    if (goal.status !== FundingGoalStatus.OPEN)
      throw new BadRequestException('Only an open goal can be cancelled');
    if (goal.goalType !== FundingGoalType.ONE_TIME)
      throw new BadRequestException('Monthly emergency cancellation must use the Safe lifecycle');
    this.assertDirectGoalController(goal, actor);
    await writeAuditEvent(this.prisma, {
      projectId: project.id,
      actor,
      entityType: 'FundingGoal',
      entityId: goalId,
      action: 'PREPARE_CANCEL',
    });
    return {
      transactionRequest: deploymentTransactionRequest({
        to,
        value: '0',
        data: encodeFunctionData({
          abi: escrowAbi,
          functionName: 'cancelGoal',
          args: [goal.chainGoalId as `0x${string}`],
        }),
      }),
    };
  }

  async safeGoalActionProposals() {
    const queueUrl = config.SAFE_ADDRESS
      ? safeWalletQueueUrl(config.SAFE_ADDRESS, config.deployment)
      : null;
    const proposals = await this.prisma.safeGoalActionProposal.findMany({
      where: { intent: { chainId: config.deployment.chainId } },
      include: {
        intent: {
          include: { goal: { select: { id: true, slug: true, title: true, status: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return proposals.map((proposal) => ({ ...proposal, queueUrl }));
  }

  async prepareGoalLifecycle(
    goalId: string,
    dto: PrepareGoalLifecycleDto,
    actor: AuthenticatedPrincipal,
  ) {
    const now = new Date();
    const goal = await this.prisma.fundingGoal.findUnique({
      where: { id: goalId, chainId: config.deployment.chainId },
    });
    if (!goal) throw new NotFoundException('On-chain goal not found');
    if (goal.goalType !== FundingGoalType.MONTHLY || goal.status !== FundingGoalStatus.OPEN) {
      throw new BadRequestException('Lifecycle actions require an open monthly goal');
    }
    if (goal.deadline <= now) {
      throw new BadRequestException('Settle overdue monthly periods before changing lifecycle');
    }
    if (
      dto.kind === SafeGoalActionKind.SET_MONTHLY_SURPLUS_POLICY &&
      dto.monthlySurplusPolicy === goal.monthlySurplusPolicy
    ) {
      throw new BadRequestException('The monthly goal already uses this surplus policy');
    }
    if (dto.kind !== SafeGoalActionKind.CANCEL_MONTHLY && goal.monthlyStopRequestedAt) {
      throw new BadRequestException('This monthly goal is already stopping');
    }

    const to = deploymentAddress();
    const data = encodeGoalLifecycleData(goal.chainGoalId, dto.kind, dto.monthlySurplusPolicy);
    const project = await this.project();

    if (
      dto.kind !== SafeGoalActionKind.CANCEL_MONTHLY &&
      this.canDirectlyControlGoal(goal, actor)
    ) {
      await writeAuditEvent(this.prisma, {
        projectId: project.id,
        actor,
        entityType: 'FundingGoal',
        entityId: goal.id,
        action: 'PREPARE_DIRECT_MONTHLY_LIFECYCLE',
        after: {
          kind: dto.kind,
          targetPolicy: dto.monthlySurplusPolicy ?? null,
          expectedDeadline: goal.deadline.toISOString(),
        },
      });
      return {
        mode: 'DIRECT' as const,
        transactionRequest: deploymentTransactionRequest({ to, value: '0', data }),
      };
    }

    if (!actor.safeOwner) {
      throw new ForbiddenException(
        dto.kind === SafeGoalActionKind.CANCEL_MONTHLY
          ? 'Emergency cancellation requires an owner of the Safe that owns the escrow'
          : 'This wallet is neither the goal controller nor an owner of the Safe that owns the escrow',
      );
    }

    const delivery = safeDelivery(dto.delivery);
    const safe = this.safeClient();
    const safeInfo =
      delivery === 'MANUAL'
        ? await safe.assertSafeEscrowOwner(actor.address)
        : await safe.assertPayoutReady(actor.address);
    const parameters = {
      targetPolicy: dto.monthlySurplusPolicy ?? null,
      expectedPolicy: goal.monthlySurplusPolicy,
      expectedDeadline: goal.deadline.toISOString(),
      expectedStopRequestedAt: goal.monthlyStopRequestedAt?.toISOString() ?? null,
      expectedStatus: goal.status,
    };

    if (delivery === 'MANUAL') {
      await this.prisma.safeGoalActionIntent.updateMany({
        where: {
          chainId: config.deployment.chainId,
          safeAddress: safeInfo.address.toLowerCase(),
          consumedAt: null,
          proposal: { is: null },
        },
        data: { consumedAt: now },
      });
      const existingProposal = await this.prisma.safeGoalActionProposal.findFirst({
        where: {
          status: { in: pendingGoalActionProposalStatuses },
          intent: {
            chainId: config.deployment.chainId,
            safeAddress: safeInfo.address.toLowerCase(),
          },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (existingProposal) {
        this.assertManualReplacementAllowed(existingProposal, dto.confirmedAbsentFromSafe);
        await this.prisma.$transaction(async (tx) => {
          const replaced = await tx.safeGoalActionProposal.updateMany({
            where: {
              id: existingProposal.id,
              status: SafeGoalActionProposalStatus.SUBMITTING,
            },
            data: {
              status: SafeGoalActionProposalStatus.STALE,
              failureReason: 'Superseded by a confirmed manual export after checking Safe.',
              lastCheckedAt: now,
            },
          });
          if (replaced.count !== 1) {
            throw new BadRequestException('The Safe proposal changed. Refresh and try again.');
          }
          await writeAuditEvent(tx, {
            projectId: project.id,
            actor,
            entityType: 'SafeGoalActionProposal',
            entityId: existingProposal.id,
            action: 'SUPERSEDE_UNCERTAIN_SAFE_PROPOSAL',
            after: { delivery, safeTxHash: existingProposal.safeTxHash },
          });
        });
      }
      await writeAuditEvent(this.prisma, {
        projectId: project.id,
        actor,
        entityType: 'FundingGoal',
        entityId: goal.id,
        action: 'EXPORT_MANUAL_SAFE_GOAL_ACTION',
        after: { kind: dto.kind, ...parameters, delivery },
      });
      return this.manualSafeExport(
        safeInfo,
        `Monthly goal: ${dto.kind}`,
        `Apply ${dto.kind} to ${goal.title}.`,
        [deploymentTransactionRequest({ to, value: '0', data })],
      );
    }

    await this.prisma.safeGoalActionIntent.updateMany({
      where: {
        chainId: config.deployment.chainId,
        safeAddress: safeInfo.address.toLowerCase(),
        consumedAt: null,
        expiresAt: { lte: now },
      },
      data: { consumedAt: now },
    });
    const existing = await this.prisma.safeGoalActionIntent.findFirst({
      where: {
        chainId: config.deployment.chainId,
        safeAddress: safeInfo.address.toLowerCase(),
        OR: [
          { consumedAt: null, expiresAt: { gt: now } },
          {
            proposal: {
              is: {
                status: {
                  in: [
                    SafeGoalActionProposalStatus.SUBMITTING,
                    SafeGoalActionProposalStatus.AWAITING_CONFIRMATIONS,
                    SafeGoalActionProposalStatus.READY_TO_EXECUTE,
                  ],
                },
              },
            },
          },
        ],
      },
      include: { proposal: true },
    });
    if (existing) {
      throw new BadRequestException(
        'Another lifecycle action is active for this Safe. Finish or replace it first.',
      );
    }

    const safeNonce = await safe.nextNonce();
    const expiresAt = new Date(Date.now() + 10 * 60_000);
    const intent = await this.prisma
      .$transaction(async (tx) => {
        const created = await tx.safeGoalActionIntent.create({
          data: {
            goalId: goal.id,
            kind: dto.kind,
            parameters,
            chainId: config.deployment.chainId,
            safeAddress: safeInfo.address.toLowerCase(),
            safeNonce: safeNonce.toString(),
            toAddress: to.toLowerCase(),
            valueRaw: '0',
            data: data.toLowerCase(),
            createdByAddress: actor.address.toLowerCase(),
            expiresAt,
          },
        });
        await writeAuditEvent(tx, {
          projectId: project.id,
          actor,
          entityType: 'SafeGoalActionIntent',
          entityId: created.id,
          action: 'PREPARE_SAFE_GOAL_ACTION',
          after: { goalId, kind: dto.kind, ...parameters, safeNonce },
        });
        return created;
      })
      .catch((error: unknown) => {
        if (this.isUniqueConstraint(error)) {
          throw new BadRequestException('Another lifecycle action is active for this Safe');
        }
        throw error;
      });

    return {
      mode: 'SAFE' as const,
      id: intent.id,
      expiresAt: intent.expiresAt.toISOString(),
      safeAddress: safeInfo.address,
      safeNonce,
      threshold: safeInfo.threshold,
      queueUrl: safeInfo.queueUrl,
      transactionRequest: deploymentTransactionRequest({ to, value: '0', data }),
    };
  }

  async submitSafeGoalAction(
    intentId: string,
    dto: SubmitSafeTransactionProposalDto,
    actor: AuthenticatedPrincipal,
  ) {
    if (!isAddressEqual(getAddress(dto.senderAddress), getAddress(actor.address))) {
      throw new ForbiddenException('The Safe proposal signer must match the signed-in wallet');
    }
    const safe = this.safeClient();
    const safeInfo = await safe.assertPayoutReady(actor.address);
    const intent = await this.prisma.safeGoalActionIntent.findUnique({
      where: { id: intentId },
      include: { proposal: true, goal: true },
    });
    if (!intent) throw new NotFoundException('Safe lifecycle intent not found');
    if (
      intent.chainId !== config.deployment.chainId ||
      !isAddressEqual(getAddress(intent.safeAddress), safeInfo.address) ||
      !isAddressEqual(getAddress(intent.toAddress), deploymentAddress())
    ) {
      throw new ForbiddenException('The lifecycle intent belongs to a different deployment');
    }
    if (
      intent.proposal &&
      intent.proposal.safeTxHash.toLowerCase() !== dto.safeTxHash.toLowerCase()
    ) {
      throw new BadRequestException('This lifecycle intent already has a different Safe proposal');
    }
    if (intent.proposal && intent.proposal.status !== SafeGoalActionProposalStatus.SUBMITTING) {
      return { ...intent.proposal, queueUrl: safeInfo.queueUrl };
    }
    if (!intent.proposal && intent.expiresAt <= new Date()) {
      throw new BadRequestException('The lifecycle intent expired. Prepare it again.');
    }
    const parameters = intent.parameters as Record<string, unknown> | null;
    if (
      intent.goal.status !== FundingGoalStatus.OPEN ||
      intent.goal.goalType !== FundingGoalType.MONTHLY ||
      intent.goal.deadline <= new Date() ||
      parameters?.expectedStatus !== intent.goal.status ||
      parameters?.expectedDeadline !== intent.goal.deadline.toISOString() ||
      parameters?.expectedPolicy !== intent.goal.monthlySurplusPolicy ||
      parameters?.expectedStopRequestedAt !==
        (intent.goal.monthlyStopRequestedAt?.toISOString() ?? null)
    ) {
      throw new BadRequestException('The monthly goal changed. Prepare a new lifecycle action.');
    }
    if (!intent.proposal && (await safe.nextNonce()) !== Number(intent.safeNonce)) {
      throw new BadRequestException('The Safe nonce changed. Prepare a new lifecycle action.');
    }

    const transaction = dto.transaction as SafeTransactionData;
    safe.validateTransactionData(
      transaction,
      {
        to: intent.toAddress,
        value: intent.valueRaw,
        data: intent.data,
        nonce: Number(intent.safeNonce),
      },
      'monthly goal lifecycle action',
    );
    const calculatedHash = await safe.transactionHash(transaction);
    if (calculatedHash.toLowerCase() !== dto.safeTxHash.toLowerCase()) {
      throw new ForbiddenException('Safe transaction hash does not match the signed transaction');
    }
    const project = await this.project();
    let proposal = intent.proposal;
    if (!proposal) {
      try {
        proposal = await this.prisma.$transaction(async (tx) => {
          const consumedAt = new Date();
          const claimed = await tx.safeGoalActionIntent.updateMany({
            where: {
              id: intent.id,
              consumedAt: null,
              expiresAt: { gt: consumedAt },
              proposal: { is: null },
            },
            data: { consumedAt },
          });
          if (claimed.count !== 1) throw new SafeGoalActionIntentClaimError();
          const created = await tx.safeGoalActionProposal.create({
            data: {
              intentId: intent.id,
              safeTxHash: calculatedHash.toLowerCase(),
              safeNonce: intent.safeNonce,
              senderAddress: actor.address.toLowerCase(),
              confirmations: 1,
              threshold: safeInfo.threshold,
              status: SafeGoalActionProposalStatus.SUBMITTING,
            },
          });
          await writeAuditEvent(tx, {
            projectId: project.id,
            actor,
            entityType: 'SafeGoalActionProposal',
            entityId: created.id,
            action: 'SUBMIT_SAFE_GOAL_ACTION_REQUESTED',
            after: { safeTxHash: calculatedHash.toLowerCase(), safeNonce: intent.safeNonce },
          });
          return created;
        });
      } catch (error) {
        if (!(error instanceof SafeGoalActionIntentClaimError) && !this.isUniqueConstraint(error)) {
          throw error;
        }
        const concurrent = await this.prisma.safeGoalActionProposal.findUnique({
          where: { intentId: intent.id },
        });
        if (!concurrent || concurrent.safeTxHash !== calculatedHash.toLowerCase()) {
          throw new BadRequestException('This lifecycle intent is no longer active');
        }
        if (concurrent.status !== SafeGoalActionProposalStatus.SUBMITTING) {
          return { ...concurrent, queueUrl: safeInfo.queueUrl };
        }
        proposal = concurrent;
      }
    }

    try {
      await safe.propose({
        transaction,
        safeTxHash: calculatedHash,
        senderAddress: actor.address,
        senderSignature: dto.senderSignature,
      });
    } catch (error) {
      await this.prisma.safeGoalActionProposal
        .updateMany({
          where: { id: proposal.id, status: SafeGoalActionProposalStatus.SUBMITTING },
          data: {
            failureReason: 'Safe submission has not been confirmed. Retry the signed proposal.',
            lastCheckedAt: new Date(),
          },
        })
        .catch(() => undefined);
      throw error;
    }
    await this.prisma.safeGoalActionProposal.updateMany({
      where: { id: proposal.id, status: SafeGoalActionProposalStatus.SUBMITTING },
      data: {
        status:
          safeInfo.threshold <= 1
            ? SafeGoalActionProposalStatus.READY_TO_EXECUTE
            : SafeGoalActionProposalStatus.AWAITING_CONFIRMATIONS,
        failureReason: null,
      },
    });
    const submitted = await this.prisma.safeGoalActionProposal.findUniqueOrThrow({
      where: { id: proposal.id },
    });
    return { ...submitted, queueUrl: safeInfo.queueUrl };
  }

  private async expireAbandonedSafeIntents() {
    await expireUnconsumedSafePayoutIntents(this.prisma, {
      chainId: config.deployment.chainId,
    });
  }

  async safeStatus(actor: AuthenticatedPrincipal) {
    const safe = this.safeClient();
    const safeAddress = safe.configuredAddress();
    if (!safeAddress) {
      return {
        configured: false,
        serviceConfigured: false,
        network: config.deployment.network,
        networkName: config.deployment.networkName,
        chainId: config.deployment.chainId,
        escrowAddress: config.deployment.escrowAddress,
        safeOwner: false,
      };
    }
    try {
      const [info, goalManagers] = await Promise.all([
        safe.runtimeInfo(true),
        this.prisma.chainAuthority.count({
          where: {
            chainId: config.deployment.chainId,
            contractAddress: config.deployment.escrowAddress.toLowerCase(),
            kind: ChainAuthorityKind.GOAL_MANAGER,
            address: { not: safeAddress.toLowerCase() },
          },
        }),
      ]);
      const ownershipAcceptance = info.isPendingEscrowOwner
        ? await safe.ownershipAcceptanceStatus(info).catch(() => null)
        : null;
      return {
        configured: true,
        serviceConfigured: safe.isConfigured(),
        network: config.deployment.network,
        networkName: config.deployment.networkName,
        chainId: config.deployment.chainId,
        escrowAddress: config.deployment.escrowAddress,
        address: info.address,
        owners: info.owners,
        threshold: info.threshold,
        nonce: info.nonce,
        escrowOwner: info.escrowOwner,
        isEscrowOwner: info.isEscrowOwner,
        pendingOwner: info.pendingOwner,
        isPendingEscrowOwner: info.isPendingEscrowOwner,
        ownershipAcceptance,
        goalManagerReady: goalManagers > 0,
        queueUrl: info.queueUrl,
        safeOwner: info.owners.some((owner) => isAddressEqual(owner, getAddress(actor.address))),
      };
    } catch (error) {
      return {
        configured: true,
        serviceConfigured: safe.isConfigured(),
        network: config.deployment.network,
        networkName: config.deployment.networkName,
        chainId: config.deployment.chainId,
        escrowAddress: config.deployment.escrowAddress,
        address: safeAddress,
        safeOwner: false,
        error: error instanceof Error ? error.message : 'Safe could not be verified',
      };
    }
  }

  private goalManagerScope() {
    return {
      chainId: config.deployment.chainId,
      contractAddress: config.deployment.escrowAddress.toLowerCase(),
    };
  }

  private assertCurrentGoalManagerActor(info: SafeRuntimeInfo, actor: AuthenticatedPrincipal) {
    const actorAddress = getAddress(actor.address);
    if (info.isEscrowOwner) {
      if (!info.owners.some((owner) => isAddressEqual(owner, actorAddress))) {
        throw new ForbiddenException('Only a current Safe owner can synchronize goal managers');
      }
      return;
    }

    if (!isAddressEqual(info.escrowOwner, actorAddress)) {
      throw new ForbiddenException(
        'Only the current direct escrow owner can synchronize goal managers before Safe takes control',
      );
    }
  }

  private mapGoalManagerProposal(
    proposal: {
      safeTxHash: string;
      safeNonce: string;
      confirmations: number;
      threshold: number;
      status: SafeGoalManagerProposalStatus;
      executionTxHash: string | null;
      failureReason: string | null;
      intent: { changes: Prisma.JsonValue };
    },
    queueUrl: string,
  ) {
    return {
      safeTxHash: proposal.safeTxHash,
      safeNonce: proposal.safeNonce,
      confirmations: proposal.confirmations,
      threshold: proposal.threshold,
      status: proposal.status,
      executionTxHash: proposal.executionTxHash,
      failureReason: proposal.failureReason,
      changes: proposal.intent.changes,
      queueUrl,
    };
  }

  private async goalManagerState(safeOwners: string[]) {
    const scope = this.goalManagerScope();
    const [actualRows, assignments] = await Promise.all([
      this.prisma.chainAuthority.findMany({
        where: { ...scope, kind: ChainAuthorityKind.GOAL_MANAGER },
        select: { address: true },
      }),
      this.prisma.goalManagerAssignment.findMany({ where: scope }),
    ]);
    const actualManagers = actualRows.map((row) => row.address.toLowerCase());
    const desiredManagers = desiredGoalManagerSet(safeOwners, actualManagers, assignments);
    return { actualManagers, assignments, desiredManagers };
  }

  async goalManagers(actor: AuthenticatedPrincipal) {
    const safe = this.safeClient();
    const configuredSafe = safe.configuredAddress();
    const safeInfo = configuredSafe ? await safe.runtimeInfo(true) : null;
    const safeOwners = safeInfo?.owners.map((owner) => owner.toLowerCase()) ?? [];
    const state = await this.goalManagerState(safeOwners);
    const addresses = [
      ...new Set([
        ...safeOwners,
        ...state.actualManagers,
        ...state.assignments.map((assignment) => assignment.address.toLowerCase()),
      ]),
    ].sort();
    const metrics = await safe.goalManagerMetrics(addresses);
    const metricByAddress = new Map(
      metrics.entries.map((entry) => [entry.address.toLowerCase(), entry]),
    );
    const safeOwnerSet = new Set(safeOwners);
    const actualSet = new Set(state.actualManagers);
    const latestProposal = configuredSafe
      ? await this.prisma.safeGoalManagerProposal.findFirst({
          where: {
            intent: {
              chainId: config.deployment.chainId,
              safeAddress: configuredSafe.toLowerCase(),
            },
          },
          include: { intent: true },
          orderBy: { createdAt: 'desc' },
        })
      : null;

    const entries = addresses.map((address) => {
      const addressAssignments = state.assignments.filter(
        (assignment) => assignment.address.toLowerCase() === address,
      );
      const manualPinned = addressAssignments.some(
        (assignment) =>
          assignment.source === GoalManagerAssignmentSource.MANUAL && assignment.desiredEnabled,
      );
      const safeManaged = addressAssignments.some(
        (assignment) => assignment.source === GoalManagerAssignmentSource.SAFE_OWNER,
      );
      const actual = actualSet.has(address);
      const desired = state.desiredManagers.has(address);
      const metric = metricByAddress.get(address);
      return {
        address: getAddress(address),
        safeOwner: safeOwnerSet.has(address),
        safeManaged,
        manualPinned,
        legacy: actual && !addressAssignments.length && !safeOwnerSet.has(address),
        actual,
        desired,
        onChainEnabled: metric?.enabled ?? actual,
        openGoalCount: metric?.openGoalCount ?? 0,
        status: actual === desired ? 'SYNCED' : desired ? 'NEEDS_ADD' : 'NEEDS_REMOVE',
      };
    });

    return {
      safeConfigured: Boolean(safeInfo),
      safeAddress: safeInfo?.address ?? null,
      safeIsEscrowOwner: safeInfo?.isEscrowOwner ?? false,
      actorIsSafeOwner:
        safeInfo?.owners.some((owner) => isAddressEqual(owner, getAddress(actor.address))) ?? false,
      maxOpenGoalsPerManager: metrics.maxOpenGoals,
      inSync: entries.every((entry) => entry.actual === entry.desired),
      entries,
      activeProposal:
        latestProposal &&
        pendingGoalManagerProposalStatuses.includes(latestProposal.status) &&
        safeInfo
          ? this.mapGoalManagerProposal(latestProposal, safeInfo.queueUrl)
          : null,
      latestProposal:
        latestProposal && safeInfo
          ? this.mapGoalManagerProposal(latestProposal, safeInfo.queueUrl)
          : null,
    };
  }

  async refreshGoalManagers() {
    if (!this.goalManagerSyncQueue) {
      throw new ServiceUnavailableException('Goal manager refresh queue is unavailable');
    }
    return this.goalManagerSyncQueue.refresh();
  }

  private async prepareGoalManagerChanges(
    rawChanges: GoalManagerChange[],
    actor: AuthenticatedPrincipal,
    desiredManagers: Set<string>,
    deliveryDto: PrepareSafeDeliveryDto,
    currentInfo?: SafeRuntimeInfo,
  ) {
    const changes = normalizedGoalManagerChanges(rawChanges);
    const safe = this.safeClient();
    const info = currentInfo ?? (await safe.runtimeInfo(true));
    this.assertCurrentGoalManagerActor(info, actor);
    if (!changes.length) return { mode: 'NONE' as const, changes: [] };
    const transactions = changes.map(goalManagerCall);

    if (!info.isEscrowOwner) {
      return { mode: 'DIRECT' as const, changes, transactions };
    }

    const delivery = safeDelivery(deliveryDto.delivery);
    const existing = await this.prisma.safeGoalManagerProposal.findFirst({
      where: {
        status: { in: pendingGoalManagerProposalStatuses },
        intent: { chainId: config.deployment.chainId, safeAddress: info.address.toLowerCase() },
      },
      include: { intent: true },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) {
      if (delivery === 'MANUAL') {
        this.assertManualReplacementAllowed(existing, deliveryDto.confirmedAbsentFromSafe);
        const project = await this.project();
        await this.prisma.$transaction(async (tx) => {
          const replaced = await tx.safeGoalManagerProposal.updateMany({
            where: {
              id: existing.id,
              status: SafeGoalManagerProposalStatus.SUBMITTING,
            },
            data: {
              status: SafeGoalManagerProposalStatus.STALE,
              activeKey: null,
              failureReason: 'Superseded by a confirmed manual export after checking Safe.',
              lastCheckedAt: new Date(),
            },
          });
          if (replaced.count !== 1) {
            throw new BadRequestException('The Safe proposal changed. Refresh and try again.');
          }
          await writeAuditEvent(tx, {
            projectId: project.id,
            actor,
            entityType: 'SafeGoalManagerProposal',
            entityId: existing.id,
            action: 'SUPERSEDE_UNCERTAIN_SAFE_PROPOSAL',
            after: { delivery: 'MANUAL', safeTxHash: existing.safeTxHash },
          });
        });
      } else {
        return {
          mode: 'PENDING' as const,
          changes,
          proposal: this.mapGoalManagerProposal(existing, info.queueUrl),
        };
      }
    }

    if (delivery === 'MANUAL') {
      const project = await this.project();
      await writeAuditEvent(this.prisma, {
        projectId: project.id,
        actor,
        entityType: 'SafeGoalManagerExport',
        entityId: info.address.toLowerCase(),
        action: 'EXPORT_MANUAL_SAFE_GOAL_MANAGERS',
        after: { changes, chainId: config.deployment.chainId },
      });
      return {
        ...this.manualSafeExport(
          info,
          'Synchronize goal managers',
          'Apply the selected goal manager changes to the precommunity escrow.',
          transactions,
        ),
        changes,
      };
    }

    if (!(await safe.transactionServiceReady(true))) {
      throw new ServiceUnavailableException(
        'Safe Transaction Service must be available to synchronize goal managers',
      );
    }

    const safeNonce = await safe.nextNonce();
    const intent = await this.prisma.safeGoalManagerIntent.create({
      data: {
        chainId: config.deployment.chainId,
        safeAddress: info.address.toLowerCase(),
        safeNonce: safeNonce.toString(),
        changes,
        desiredStateHash: goalManagerStateHash(desiredManagers),
        createdByAddress: actor.address.toLowerCase(),
        expiresAt: new Date(Date.now() + 10 * 60_000),
      },
    });
    return {
      mode: 'SAFE' as const,
      intentId: intent.id,
      changes,
      transactions,
      safeAddress: info.address,
      safeNonce,
      threshold: info.threshold,
      queueUrl: info.queueUrl,
    };
  }

  async prepareSafeGoalManagerSync(
    actor: AuthenticatedPrincipal,
    dto: PrepareSafeDeliveryDto = {},
  ) {
    const safe = this.safeClient();
    const info = await safe.runtimeInfo(true);
    this.assertCurrentGoalManagerActor(info, actor);
    await reconcileSafeOwnerGoalManagerAssignments(this.prisma, {
      ...this.goalManagerScope(),
      safeOwners: info.owners,
    });
    const state = await this.goalManagerState(info.owners);
    const actual = new Set(state.actualManagers);
    const changes: GoalManagerChange[] = [
      ...[...state.desiredManagers]
        .filter((address) => !actual.has(address))
        .map((address) => ({ address, enabled: true })),
      ...state.actualManagers
        .filter((address) => !state.desiredManagers.has(address))
        .map((address) => ({ address, enabled: false })),
    ];
    return this.prepareGoalManagerChanges(changes, actor, state.desiredManagers, dto, info);
  }

  async updateGoalManager(
    addressValue: string,
    dto: UpdateGoalManagerDto,
    actor: AuthenticatedPrincipal,
  ) {
    if (!isAddress(addressValue)) throw new BadRequestException('Goal manager address is invalid');
    const address = getAddress(addressValue);
    const safe = this.safeClient();
    const info = await safe.runtimeInfo(true);
    this.assertCurrentGoalManagerActor(info, actor);
    if (
      isAddressEqual(address, zeroAddress) ||
      isAddressEqual(address, getAddress(config.deployment.escrowAddress)) ||
      isAddressEqual(address, info.address)
    ) {
      throw new BadRequestException(
        'The zero, escrow and Safe addresses cannot be manual goal managers',
      );
    }
    if (info.isEscrowOwner && safeDelivery(dto.delivery) === 'MANUAL') {
      const existing = await this.prisma.safeGoalManagerProposal.findFirst({
        where: {
          status: { in: pendingGoalManagerProposalStatuses },
          intent: { chainId: config.deployment.chainId, safeAddress: info.address.toLowerCase() },
        },
        include: { intent: true },
        orderBy: { createdAt: 'desc' },
      });
      if (existing) {
        this.assertManualReplacementAllowed(existing, dto.confirmedAbsentFromSafe);
      }
    }
    await reconcileSafeOwnerGoalManagerAssignments(this.prisma, {
      ...this.goalManagerScope(),
      safeOwners: info.owners,
    });
    const scope = this.goalManagerScope();
    await this.prisma.goalManagerAssignment.upsert({
      where: {
        chainId_contractAddress_address_source: {
          ...scope,
          address: address.toLowerCase(),
          source: GoalManagerAssignmentSource.MANUAL,
        },
      },
      update: { desiredEnabled: dto.enabled },
      create: {
        ...scope,
        address: address.toLowerCase(),
        source: GoalManagerAssignmentSource.MANUAL,
        desiredEnabled: dto.enabled,
      },
    });
    const state = await this.goalManagerState(info.owners);
    const actual = state.actualManagers.includes(address.toLowerCase());
    const desired = state.desiredManagers.has(address.toLowerCase());
    const desiredStateHash = goalManagerStateHash(state.desiredManagers);
    await this.prisma.safeGoalManagerProposal.updateMany({
      where: {
        status: { in: pendingGoalManagerProposalStatuses },
        intent: {
          chainId: config.deployment.chainId,
          safeAddress: info.address.toLowerCase(),
          desiredStateHash: { not: desiredStateHash },
        },
      },
      data: {
        failureReason:
          'Manual goal manager settings changed. Cancel or replace this proposal at its current nonce in Safe before preparing another sync.',
        lastCheckedAt: new Date(),
      },
    });
    const project = await this.project();
    await writeAuditEvent(this.prisma, {
      projectId: project.id,
      actor,
      entityType: 'GoalManagerAssignment',
      entityId: address.toLowerCase(),
      action: dto.enabled ? 'PIN_GOAL_MANAGER' : 'UNPIN_GOAL_MANAGER',
      after: {
        address: address.toLowerCase(),
        desired,
        safeOwner: info.owners.some((owner) => isAddressEqual(owner, address)),
      },
    });
    return this.prepareGoalManagerChanges(
      actual === desired ? [] : [{ address, enabled: desired }],
      actor,
      state.desiredManagers,
      dto,
      info,
    );
  }

  async submitSafeGoalManagerIntent(
    intentId: string,
    dto: SubmitSafeTransactionProposalDto,
    actor: AuthenticatedPrincipal,
  ) {
    if (!isAddressEqual(getAddress(dto.senderAddress), getAddress(actor.address))) {
      throw new ForbiddenException('The Safe proposal signer must match the signed-in wallet');
    }
    const safe = this.safeClient();
    const info = await safe.assertPayoutReady(actor.address);
    const intent = await this.prisma.safeGoalManagerIntent.findUnique({
      where: { id: intentId },
      include: { proposal: true },
    });
    if (!intent) throw new NotFoundException('Goal manager intent not found');
    if (
      intent.chainId !== config.deployment.chainId ||
      !isAddressEqual(getAddress(intent.safeAddress), info.address)
    ) {
      throw new ForbiddenException('The goal manager intent belongs to another deployment');
    }
    if (
      intent.proposal &&
      intent.proposal.safeTxHash.toLowerCase() !== dto.safeTxHash.toLowerCase()
    ) {
      throw new BadRequestException('This intent already has a different Safe proposal');
    }
    if (intent.proposal && intent.proposal.status !== SafeGoalManagerProposalStatus.SUBMITTING) {
      return this.mapGoalManagerProposal({ ...intent.proposal, intent }, info.queueUrl);
    }
    if (!intent.proposal && intent.expiresAt <= new Date()) {
      throw new BadRequestException('The goal manager intent expired. Prepare it again.');
    }
    const state = await this.goalManagerState(info.owners);
    if (goalManagerStateHash(state.desiredManagers) !== intent.desiredStateHash) {
      throw new BadRequestException(
        'Safe owners or manual goal manager settings changed. Prepare a new sync.',
      );
    }
    if (!Array.isArray(intent.changes))
      throw new BadRequestException('Goal manager intent is invalid');
    const changes = normalizedGoalManagerChanges(
      intent.changes.map((change) => {
        if (
          typeof change !== 'object' ||
          change === null ||
          !('address' in change) ||
          !('enabled' in change) ||
          typeof change.address !== 'string' ||
          typeof change.enabled !== 'boolean'
        ) {
          throw new BadRequestException('Goal manager intent contains invalid changes');
        }
        return { address: change.address, enabled: change.enabled };
      }),
    );
    const actualManagers = new Set(state.actualManagers);
    const currentChanges: GoalManagerChange[] = [
      ...[...state.desiredManagers]
        .filter((address) => !actualManagers.has(address))
        .map((address) => ({ address, enabled: true })),
      ...state.actualManagers
        .filter((address) => !state.desiredManagers.has(address))
        .map((address) => ({ address, enabled: false })),
    ];
    if (!sameGoalManagerChanges(changes, currentChanges)) {
      throw new BadRequestException(
        'Confirmed goal manager state changed. Prepare a new synchronization.',
      );
    }
    if (!intent.proposal && (await safe.nextNonce()) !== Number(intent.safeNonce)) {
      throw new BadRequestException('The Safe nonce changed. Prepare a new synchronization.');
    }
    const expected = await safe.createTransactionData(
      changes.map(goalManagerCall),
      Number(intent.safeNonce),
    );
    const transaction = dto.transaction as SafeTransactionData;
    safe.validateExactTransactionData(transaction, expected, 'goal manager synchronization');
    const calculatedHash = await safe.transactionHash(transaction);
    if (calculatedHash.toLowerCase() !== dto.safeTxHash.toLowerCase()) {
      throw new ForbiddenException('Safe transaction hash does not match the signed transaction');
    }
    let proposal = intent.proposal;
    if (!proposal) {
      try {
        proposal = await this.prisma.$transaction(async (tx) => {
          const claimedAt = new Date();
          const claimed = await tx.safeGoalManagerIntent.updateMany({
            where: {
              id: intent.id,
              consumedAt: null,
              expiresAt: { gt: claimedAt },
              proposal: { is: null },
            },
            data: { consumedAt: claimedAt },
          });
          if (claimed.count !== 1) throw new SafeGoalManagerIntentClaimError();
          return tx.safeGoalManagerProposal.create({
            data: {
              intentId: intent.id,
              activeKey: `${intent.chainId}:${intent.safeAddress}`,
              safeTxHash: calculatedHash.toLowerCase(),
              safeNonce: intent.safeNonce,
              senderAddress: actor.address.toLowerCase(),
              confirmations: 1,
              threshold: info.threshold,
              status: SafeGoalManagerProposalStatus.SUBMITTING,
            },
          });
        });
      } catch (error) {
        if (
          !(error instanceof SafeGoalManagerIntentClaimError) &&
          !this.isUniqueConstraint(error)
        ) {
          throw error;
        }
        const concurrent = await this.prisma.safeGoalManagerProposal.findUnique({
          where: { intentId: intent.id },
        });
        if (!concurrent) {
          throw new BadRequestException(
            'Another goal manager proposal is active. Finish or replace it in Safe first.',
          );
        }
        if (concurrent.safeTxHash.toLowerCase() !== calculatedHash.toLowerCase()) {
          throw new BadRequestException('This intent already has a different Safe proposal');
        }
        if (concurrent.status !== SafeGoalManagerProposalStatus.SUBMITTING) {
          return this.mapGoalManagerProposal({ ...concurrent, intent }, info.queueUrl);
        }
        proposal = concurrent;
      }
    }

    try {
      await safe.propose({
        transaction,
        safeTxHash: calculatedHash,
        senderAddress: actor.address,
        senderSignature: dto.senderSignature,
      });
    } catch (error) {
      await this.prisma.safeGoalManagerProposal
        .updateMany({
          where: { id: proposal.id, status: SafeGoalManagerProposalStatus.SUBMITTING },
          data: {
            failureReason: 'Safe submission has not been confirmed. Retry the signed proposal.',
            lastCheckedAt: new Date(),
          },
        })
        .catch(() => undefined);
      throw error;
    }

    await this.prisma.safeGoalManagerProposal.updateMany({
      where: { id: proposal.id, status: SafeGoalManagerProposalStatus.SUBMITTING },
      data: {
        status:
          info.threshold <= 1
            ? SafeGoalManagerProposalStatus.READY_TO_EXECUTE
            : SafeGoalManagerProposalStatus.AWAITING_CONFIRMATIONS,
        failureReason: null,
      },
    });
    const submitted = await this.prisma.safeGoalManagerProposal.findUniqueOrThrow({
      where: { id: proposal.id },
      include: { intent: true },
    });
    return this.mapGoalManagerProposal(submitted, info.queueUrl);
  }

  async prepareSafeOwnershipTransfer(actor: AuthenticatedPrincipal) {
    const safe = this.safeClient();
    if (
      !actor.chainAuthorities.includes(ChainAuthorityKind.OWNER) ||
      !actor.chainOwnerAddress ||
      actor.chainOwnerAddress.toLowerCase() !== actor.address.toLowerCase()
    ) {
      throw new ForbiddenException('Only the current direct escrow owner can transfer ownership');
    }
    const safeAddress = safe.configuredAddress();
    if (!safeAddress) throw new ServiceUnavailableException('Safe address is not configured');
    const managerCount = await this.prisma.chainAuthority.count({
      where: {
        chainId: config.deployment.chainId,
        contractAddress: config.deployment.escrowAddress.toLowerCase(),
        kind: ChainAuthorityKind.GOAL_MANAGER,
        address: { not: safeAddress.toLowerCase() },
      },
    });
    if (managerCount === 0) {
      throw new BadRequestException(
        'Add and confirm at least one direct goal manager before transferring ownership to Safe',
      );
    }
    const transactionRequest = await safe.ownershipTransferRequest(actor.address);
    const project = await this.project();
    await writeAuditEvent(this.prisma, {
      projectId: project.id,
      actor,
      entityType: 'EscrowOwnership',
      entityId: config.deployment.escrowAddress.toLowerCase(),
      action: 'PREPARE_SAFE_OWNERSHIP_TRANSFER',
      after: { safeAddress: safeAddress.toLowerCase(), chainId: config.deployment.chainId },
    });
    return { transactionRequest };
  }

  async prepareSafeOwnershipAcceptance(
    actor: AuthenticatedPrincipal,
    dto: PrepareSafeDeliveryDto = {},
  ) {
    const safe = this.safeClient();
    const delivery = safeDelivery(dto.delivery);
    const entityId = config.deployment.escrowAddress.toLowerCase();
    const acceptance =
      delivery === 'MANUAL'
        ? await safe.manualOwnershipAcceptanceRequest(actor.address)
        : await safe.ownershipAcceptanceRequest(actor.address);
    let replacesUncertainProposal = false;
    if (delivery === 'MANUAL') {
      const latestAttempt = await this.prisma.auditEvent.findFirst({
        where: {
          entityType: 'EscrowOwnership',
          entityId,
          action: {
            in: [
              'SAFE_OWNERSHIP_ACCEPTANCE_UNCONFIRMED',
              'SUBMIT_SAFE_OWNERSHIP_ACCEPTANCE',
              'OBSERVE_SAFE_OWNERSHIP_ACCEPTANCE',
              'SUPERSEDE_UNCERTAIN_SAFE_OWNERSHIP_ACCEPTANCE',
            ],
          },
        },
        select: { action: true },
        orderBy: { createdAt: 'desc' },
      });
      if (
        latestAttempt?.action === 'SUBMIT_SAFE_OWNERSHIP_ACCEPTANCE' ||
        latestAttempt?.action === 'OBSERVE_SAFE_OWNERSHIP_ACCEPTANCE'
      ) {
        throw new BadRequestException(
          'An ownership acceptance is already waiting in Safe and cannot be duplicated.',
        );
      }
      if (latestAttempt?.action === 'SAFE_OWNERSHIP_ACCEPTANCE_UNCONFIRMED') {
        this.assertManualReplacementAllowed(
          { status: 'SUBMITTING', failureReason: 'Safe submission was not confirmed.' },
          dto.confirmedAbsentFromSafe,
        );
        replacesUncertainProposal = true;
      }
    }
    const project = await this.project();
    await writeAuditEvent(this.prisma, {
      projectId: project.id,
      actor,
      entityType: 'EscrowOwnership',
      entityId,
      action: replacesUncertainProposal
        ? 'SUPERSEDE_UNCERTAIN_SAFE_OWNERSHIP_ACCEPTANCE'
        : delivery === 'MANUAL'
          ? 'EXPORT_MANUAL_SAFE_OWNERSHIP_ACCEPTANCE'
          : 'existingProposal' in acceptance && acceptance.existingProposal
            ? 'OBSERVE_SAFE_OWNERSHIP_ACCEPTANCE'
            : 'PREPARE_SAFE_OWNERSHIP_ACCEPTANCE',
      after: {
        safeAddress: acceptance.safeAddress.toLowerCase(),
        safeNonce: 'safeNonce' in acceptance ? acceptance.safeNonce : null,
        chainId: config.deployment.chainId,
        delivery,
        confirmedAbsentFromSafe: dto.confirmedAbsentFromSafe ?? false,
      },
    });
    if (delivery === 'MANUAL') {
      return this.manualSafeExport(
        { address: acceptance.safeAddress, queueUrl: acceptance.queueUrl },
        'Accept escrow ownership',
        'Accept the configured Safe as the owner of the precommunity escrow.',
        [acceptance.transactionRequest],
      );
    }
    return acceptance;
  }

  async submitSafeOwnershipAcceptance(
    dto: SubmitSafeTransactionProposalDto,
    actor: AuthenticatedPrincipal,
  ) {
    const safe = this.safeClient();
    const acceptance = await safe.ownershipAcceptanceRequest(actor.address);
    if (acceptance.existingProposal) {
      if (acceptance.existingProposal.safeTxHash.toLowerCase() !== dto.safeTxHash.toLowerCase()) {
        throw new BadRequestException('A different ownership acceptance is already in Safe');
      }
      return acceptance.existingProposal;
    }

    const transaction = dto.transaction as SafeTransactionData;
    safe.validateTransactionData(
      transaction,
      {
        to: acceptance.transactionRequest.to,
        value: acceptance.transactionRequest.value,
        data: acceptance.transactionRequest.data,
        nonce: acceptance.safeNonce,
      },
      'ownership acceptance request',
    );
    const calculatedHash = await safe.transactionHash(transaction);
    if (calculatedHash.toLowerCase() !== dto.safeTxHash.toLowerCase()) {
      throw new ForbiddenException('Safe transaction hash does not match the signed transaction');
    }
    const project = await this.project();
    const ownershipAudit = (action: string) =>
      writeAuditEvent(this.prisma, {
        projectId: project.id,
        actor,
        entityType: 'EscrowOwnership',
        entityId: config.deployment.escrowAddress.toLowerCase(),
        action,
        after: {
          safeTxHash: calculatedHash.toLowerCase(),
          safeNonce: acceptance.safeNonce,
        },
      }).catch(() => undefined);
    try {
      await safe.propose({
        transaction,
        safeTxHash: calculatedHash,
        senderAddress: actor.address,
        senderSignature: dto.senderSignature,
      });
    } catch (error) {
      await ownershipAudit('SAFE_OWNERSHIP_ACCEPTANCE_UNCONFIRMED');
      throw error;
    }
    await ownershipAudit('SUBMIT_SAFE_OWNERSHIP_ACCEPTANCE');
    return {
      safeTxHash: calculatedHash,
      safeNonce: acceptance.safeNonce,
      confirmations: 1,
      threshold: acceptance.threshold,
      readyToExecute: acceptance.threshold <= 1,
      queueUrl: acceptance.queueUrl,
    };
  }

  async createSafePayoutIntent(
    goalId: string,
    dto: ReleaseProposalDto,
    actor: AuthenticatedPrincipal,
  ) {
    const delivery = safeDelivery(dto.delivery);
    const safe = this.safeClient();
    const safeInfo =
      delivery === 'MANUAL'
        ? await safe.assertSafeEscrowOwner(actor.address)
        : await safe.assertPayoutReady(actor.address);
    await this.expireAbandonedSafeIntents();
    const now = new Date();
    const activeIntent = await this.prisma.safePayoutIntent.findFirst({
      where: {
        chainId: config.deployment.chainId,
        safeAddress: safeInfo.address.toLowerCase(),
        payout: { status: PayoutStatus.PROPOSED },
        OR: [
          { delivery: SafePayoutDelivery.MANUAL },
          {
            delivery: SafePayoutDelivery.SERVICE,
            consumedAt: null,
            expiresAt: { gt: now },
          },
          { proposal: { is: { status: { in: pendingPayoutProposalStatuses } } } },
        ],
      },
      include: { payout: true, proposal: true, goal: true },
      orderBy: { createdAt: 'desc' },
    });
    if (activeIntent) {
      const sameRequest =
        activeIntent.goalId === goalId &&
        activeIntent.payout.asset === dto.asset &&
        activeIntent.payout.kind === dto.kind &&
        activeIntent.payout.amountRaw === dto.amountRaw;
      if (!sameRequest) {
        throw new BadRequestException(
          'Another payout is being prepared or submitted for this Safe. Finish it before starting a new one.',
        );
      }

      if (delivery === 'MANUAL') {
        const project = await this.project();
        if (activeIntent.delivery !== SafePayoutDelivery.MANUAL) {
          if (activeIntent.proposal) {
            this.assertManualReplacementAllowed(activeIntent.proposal, dto.confirmedAbsentFromSafe);
          }
          await this.prisma.$transaction(async (tx) => {
            if (activeIntent.proposal) {
              const replaced = await tx.safePayoutProposal.updateMany({
                where: {
                  id: activeIntent.proposal.id,
                  status: SafePayoutProposalStatus.SUBMITTING,
                },
                data: {
                  status: SafePayoutProposalStatus.STALE,
                  failureReason: 'Superseded by a confirmed manual export after checking Safe.',
                  lastCheckedAt: now,
                },
              });
              if (replaced.count !== 1) {
                throw new BadRequestException('The Safe proposal changed. Refresh and try again.');
              }
              await writeAuditEvent(tx, {
                projectId: project.id,
                actor,
                entityType: 'SafePayoutProposal',
                entityId: activeIntent.proposal.id,
                action: 'SUPERSEDE_UNCERTAIN_SAFE_PROPOSAL',
                after: {
                  delivery,
                  safeTxHash: activeIntent.proposal.safeTxHash,
                },
              });
            }
            await tx.safePayoutIntent.update({
              where: { id: activeIntent.id },
              data: {
                delivery: SafePayoutDelivery.MANUAL,
                safeNonce: null,
                expiresAt: null,
                consumedAt: null,
              },
            });
          });
          activeIntent.delivery = SafePayoutDelivery.MANUAL;
          activeIntent.safeNonce = null;
          activeIntent.expiresAt = null;
          activeIntent.consumedAt = null;
        }
        await writeAuditEvent(this.prisma, {
          projectId: project.id,
          actor,
          entityType: 'SafePayoutIntent',
          entityId: activeIntent.id,
          action: 'EXPORT_MANUAL_SAFE_PAYOUT',
          after: { ...dto, idempotent: true, delivery },
        });
        return this.manualPayoutResponse(safeInfo, activeIntent, activeIntent.goal.title);
      }

      if (activeIntent.delivery === SafePayoutDelivery.MANUAL) {
        throw new BadRequestException(
          'This payout is reserved for manual execution. Execute or cancel it before using Safe API.',
        );
      }
      if (
        activeIntent.proposal &&
        activeIntent.proposal.status !== SafePayoutProposalStatus.SUBMITTING
      ) {
        throw new BadRequestException('This payout already has an active Safe proposal.');
      }
      if (activeIntent.expiresAt && activeIntent.safeNonce !== null) {
        return {
          delivery: 'SERVICE' as const,
          id: activeIntent.id,
          expiresAt: activeIntent.expiresAt.toISOString(),
          safeAddress: safeInfo.address,
          safeNonce: Number(activeIntent.safeNonce),
          threshold: safeInfo.threshold,
          queueUrl: safeInfo.queueUrl,
          transactionRequest: deploymentTransactionRequest({
            to: getAddress(activeIntent.toAddress),
            value: activeIntent.valueRaw,
            data: activeIntent.data as `0x${string}`,
          }),
        };
      }
      throw new BadRequestException('This Safe payout intent is no longer usable.');
    }

    const to = deploymentAddress();
    const project = await this.project();
    const goal = await this.prisma.fundingGoal.findUnique({
      where: { id: goalId, chainId: config.deployment.chainId },
      include: { payouts: true },
    });
    if (!goal) throw new NotFoundException('On-chain goal not found');
    if (
      dto.kind === 'EXPENSE' &&
      goal.goalType === FundingGoalType.ONE_TIME &&
      goal.status !== FundingGoalStatus.CLOSED
    ) {
      throw new BadRequestException('One-time recipient funds require a closed goal');
    }
    if (dto.kind === 'CANCELLED_FUNDS' && goal.status !== FundingGoalStatus.CANCELLED)
      throw new BadRequestException('Treasury funds require a cancelled goal');
    const kind = dto.kind === 'EXPENSE' ? PayoutKind.EXPENSE : PayoutKind.CANCELLED_FUNDS;
    const entitlementRaw = BigInt(
      dto.kind === 'EXPENSE'
        ? dto.asset === FundingAsset.PRE
          ? goal.preRecipientEntitlementRaw
          : goal.usdcRecipientEntitlementRaw
        : dto.asset === FundingAsset.PRE
          ? goal.preTreasuryEntitlementRaw
          : goal.usdcTreasuryEntitlementRaw,
    );
    const releasedRaw = goal.payouts
      .filter(
        (item) =>
          item.asset === dto.asset && item.kind === kind && item.status === PayoutStatus.EXECUTED,
      )
      .reduce((sum, item) => sum + BigInt(item.amountRaw), 0n);
    const reservedRaw = goal.payouts
      .filter(
        (item) =>
          item.asset === dto.asset && item.kind === kind && item.status === PayoutStatus.PROPOSED,
      )
      .reduce((sum, item) => sum + BigInt(item.amountRaw), 0n);
    const alreadyAllocated = releasedRaw + reservedRaw;
    const availableRaw = entitlementRaw > alreadyAllocated ? entitlementRaw - alreadyAllocated : 0n;
    if (BigInt(dto.amountRaw) > availableRaw)
      throw new BadRequestException('Requested amount exceeds the confirmed available balance');
    const token =
      dto.asset === FundingAsset.PRE ? config.deployment.preAddress : config.deployment.usdcAddress;
    const functionName = dto.kind === 'EXPENSE' ? 'releaseExpense' : 'releaseCancelledFunds';
    const data = encodeFunctionData({
      abi: escrowAbi,
      functionName,
      args: [goal.chainGoalId as `0x${string}`, getAddress(token), BigInt(dto.amountRaw)],
    });
    const safeNonce = delivery === 'SERVICE' ? await safe.nextNonce() : null;
    const expiresAt = delivery === 'SERVICE' ? new Date(Date.now() + 10 * 60_000) : null;
    const recipientAddress =
      kind === PayoutKind.EXPENSE
        ? goal.recipientAddress.toLowerCase()
        : config.deployment.treasury.toLowerCase();
    const intent = await this.prisma
      .$transaction(async (tx) => {
        const payout = await tx.payout.create({
          data: {
            goalId,
            asset: dto.asset,
            kind,
            amountRaw: dto.amountRaw,
            recipientAddress,
            status: PayoutStatus.PROPOSED,
          },
        });
        const created = await tx.safePayoutIntent.create({
          data: {
            payoutId: payout.id,
            goalId,
            chainId: config.deployment.chainId,
            safeAddress: safeInfo.address.toLowerCase(),
            delivery:
              delivery === 'MANUAL' ? SafePayoutDelivery.MANUAL : SafePayoutDelivery.SERVICE,
            safeNonce: safeNonce?.toString() ?? null,
            toAddress: to.toLowerCase(),
            valueRaw: '0',
            data: data.toLowerCase(),
            createdByAddress: actor.address.toLowerCase(),
            expiresAt,
          },
        });
        await writeAuditEvent(tx, {
          projectId: project.id,
          actor,
          entityType: 'SafePayoutIntent',
          entityId: created.id,
          action: delivery === 'MANUAL' ? 'EXPORT_MANUAL_SAFE_PAYOUT' : 'PREPARE_SAFE_PAYOUT',
          after: {
            ...dto,
            safeAddress: safeInfo.address.toLowerCase(),
            safeNonce,
            delivery,
          },
        });
        return created;
      })
      .catch(async (error: unknown) => {
        if (this.isUniqueConstraint(error)) {
          if (delivery === 'MANUAL') {
            const concurrent = await this.prisma.safePayoutIntent.findFirst({
              where: {
                chainId: config.deployment.chainId,
                safeAddress: safeInfo.address.toLowerCase(),
                delivery: SafePayoutDelivery.MANUAL,
                goalId,
                payout: {
                  asset: dto.asset,
                  kind,
                  amountRaw: dto.amountRaw,
                  status: PayoutStatus.PROPOSED,
                },
              },
            });
            if (concurrent) return concurrent;
          }
          throw new BadRequestException(
            'Another payout is being prepared for this Safe. Try this payout again in a moment.',
          );
        }
        throw error;
      });
    if (delivery === 'MANUAL') {
      return this.manualPayoutResponse(
        safeInfo,
        { ...intent, payout: { asset: dto.asset, kind, amountRaw: dto.amountRaw } },
        goal.title,
      );
    }
    return {
      delivery: 'SERVICE' as const,
      id: intent.id,
      expiresAt: intent.expiresAt!.toISOString(),
      safeAddress: safeInfo.address,
      safeNonce: safeNonce!,
      threshold: safeInfo.threshold,
      queueUrl: safeInfo.queueUrl,
      transactionRequest: deploymentTransactionRequest({ to, value: '0', data }),
    };
  }

  async submitSafePayoutProposal(
    intentId: string,
    dto: SubmitSafePayoutProposalDto,
    actor: AuthenticatedPrincipal,
  ) {
    if (!isAddressEqual(getAddress(dto.senderAddress), getAddress(actor.address))) {
      throw new ForbiddenException('The Safe proposal signer must match the signed-in wallet');
    }
    const safe = this.safeClient();
    const intent = await this.prisma.safePayoutIntent.findUnique({
      where: { id: intentId },
      include: { proposal: true, payout: true },
    });
    if (!intent) throw new NotFoundException('Safe payout intent not found');
    if (
      intent.delivery === SafePayoutDelivery.MANUAL ||
      intent.safeNonce === null ||
      intent.expiresAt === null
    ) {
      throw new BadRequestException(
        'Manual payout reservations must be executed in Safe Wallet, not submitted through the API.',
      );
    }
    const safeNonce = intent.safeNonce;
    const expiresAt = intent.expiresAt;
    const safeInfo = await safe.assertPayoutReady(actor.address);
    if (
      intent.chainId !== config.deployment.chainId ||
      !isAddressEqual(getAddress(intent.safeAddress), safeInfo.address) ||
      !isAddressEqual(getAddress(intent.toAddress), deploymentAddress())
    ) {
      throw new ForbiddenException('The payout intent belongs to a different deployment');
    }
    if (
      intent.proposal &&
      intent.proposal.safeTxHash.toLowerCase() !== dto.safeTxHash.toLowerCase()
    ) {
      throw new BadRequestException('This payout intent already has a different Safe proposal');
    }
    if (intent.proposal && intent.proposal.status !== SafePayoutProposalStatus.SUBMITTING) {
      return this.mapSafeProposal(intent.proposal, intent, intent.payout, safeInfo.queueUrl);
    }
    if (intent.payout.status !== PayoutStatus.PROPOSED) {
      throw new BadRequestException('This payout intent is no longer active');
    }
    if (!intent.proposal && expiresAt <= new Date()) {
      await expireUnconsumedSafePayoutIntents(this.prisma, {
        chainId: config.deployment.chainId,
      });
      throw new BadRequestException('The payout intent has expired. Create a new one.');
    }
    if (!intent.proposal && (await safe.nextNonce()) !== Number(safeNonce)) {
      throw new BadRequestException('The Safe nonce changed. Create a new payout request.');
    }

    const transaction = dto.transaction as SafeTransactionData;
    safe.validateTransactionData(transaction, {
      to: intent.toAddress,
      value: intent.valueRaw,
      data: intent.data,
      nonce: Number(safeNonce),
    });
    const calculatedHash = await safe.transactionHash(transaction);
    if (calculatedHash.toLowerCase() !== dto.safeTxHash.toLowerCase()) {
      throw new ForbiddenException('Safe transaction hash does not match the signed transaction');
    }
    const project = await this.project();
    let proposal = intent.proposal;
    if (!proposal) {
      try {
        proposal = await this.prisma.$transaction(async (tx) => {
          const consumedAt = new Date();
          const claimed = await tx.safePayoutIntent.updateMany({
            where: {
              id: intent.id,
              delivery: SafePayoutDelivery.SERVICE,
              consumedAt: null,
              expiresAt: { gt: consumedAt },
              proposal: { is: null },
              payout: { status: PayoutStatus.PROPOSED },
            },
            data: { consumedAt },
          });
          if (claimed.count !== 1) throw new SafePayoutIntentClaimError();

          const created = await tx.safePayoutProposal.create({
            data: {
              intentId: intent.id,
              safeTxHash: calculatedHash.toLowerCase(),
              safeNonce,
              senderAddress: actor.address.toLowerCase(),
              confirmations: 1,
              threshold: safeInfo.threshold,
              status: SafePayoutProposalStatus.SUBMITTING,
            },
          });
          await writeAuditEvent(tx, {
            projectId: project.id,
            actor,
            entityType: 'SafePayoutProposal',
            entityId: created.id,
            action: 'SUBMIT_SAFE_PAYOUT_REQUESTED',
            after: { safeTxHash: calculatedHash.toLowerCase(), safeNonce },
          });
          return created;
        });
      } catch (error) {
        if (!(error instanceof SafePayoutIntentClaimError) && !this.isUniqueConstraint(error)) {
          throw error;
        }
        const concurrent = await this.prisma.safePayoutProposal.findUnique({
          where: { intentId: intent.id },
        });
        if (!concurrent) {
          throw new BadRequestException(
            expiresAt <= new Date()
              ? 'The payout intent has expired. Create a new one.'
              : 'This payout intent is no longer active',
          );
        }
        if (concurrent.safeTxHash !== calculatedHash.toLowerCase()) {
          throw new BadRequestException('This payout intent already has a different Safe proposal');
        }
        if (concurrent.status !== SafePayoutProposalStatus.SUBMITTING) {
          return this.mapSafeProposal(concurrent, intent, intent.payout, safeInfo.queueUrl);
        }
        proposal = concurrent;
      }
    }

    try {
      await safe.propose({
        transaction,
        safeTxHash: calculatedHash,
        senderAddress: actor.address,
        senderSignature: dto.senderSignature,
      });
    } catch (error) {
      await this.prisma.safePayoutProposal
        .updateMany({
          where: { id: proposal.id, status: SafePayoutProposalStatus.SUBMITTING },
          data: {
            failureReason: 'Safe submission has not been confirmed. Retry the signed proposal.',
            lastCheckedAt: new Date(),
          },
        })
        .catch(() => undefined);
      throw error;
    }

    const submitted = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.safePayoutProposal.updateMany({
        where: { id: proposal.id, status: SafePayoutProposalStatus.SUBMITTING },
        data: {
          status:
            safeInfo.threshold <= 1
              ? SafePayoutProposalStatus.READY_TO_EXECUTE
              : SafePayoutProposalStatus.AWAITING_CONFIRMATIONS,
          failureReason: null,
        },
      });
      const current = await tx.safePayoutProposal.findUniqueOrThrow({
        where: { id: proposal.id },
      });
      if (updated.count) {
        await writeAuditEvent(tx, {
          projectId: project.id,
          actor,
          entityType: 'SafePayoutProposal',
          entityId: current.id,
          action: 'SUBMIT_SAFE_PAYOUT',
          after: { safeTxHash: calculatedHash.toLowerCase(), safeNonce },
        });
      }
      return current;
    });
    return this.mapSafeProposal(submitted, intent, intent.payout, safeInfo.queueUrl);
  }

  async cancelManualSafePayout(intentId: string, actor: AuthenticatedPrincipal) {
    const safeInfo = await this.safeClient().assertOwner(actor.address, true);
    const intent = await this.prisma.safePayoutIntent.findUnique({
      where: { id: intentId },
      include: { payout: true },
    });
    if (!intent) throw new NotFoundException('Manual payout reservation not found');
    if (
      intent.delivery !== SafePayoutDelivery.MANUAL ||
      intent.chainId !== config.deployment.chainId ||
      !isAddressEqual(getAddress(intent.safeAddress), safeInfo.address)
    ) {
      throw new ForbiddenException('This is not a manual payout reservation for this Safe');
    }
    const project = await this.project();
    const cancelledAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      const cancelled = await tx.payout.updateMany({
        where: { id: intent.payoutId, status: PayoutStatus.PROPOSED },
        data: { status: PayoutStatus.FAILED },
      });
      if (cancelled.count !== 1) {
        throw new BadRequestException('This payout is already executed or cancelled');
      }
      await tx.safePayoutIntent.update({
        where: { id: intent.id },
        data: { consumedAt: cancelledAt },
      });
      await writeAuditEvent(tx, {
        projectId: project.id,
        actor,
        entityType: 'SafePayoutIntent',
        entityId: intent.id,
        action: 'CANCEL_MANUAL_SAFE_PAYOUT_RESERVATION',
        before: {
          payoutStatus: intent.payout.status,
          amountRaw: intent.payout.amountRaw,
          asset: intent.payout.asset,
        },
        after: {
          payoutStatus: PayoutStatus.FAILED,
          cancelledAt: cancelledAt.toISOString(),
        },
      });
    });
    return { id: intent.id, status: 'CANCELLED' as const };
  }

  async safePayoutProposals() {
    await this.expireAbandonedSafeIntents();
    const safeAddress = this.safeClient().configuredAddress();
    if (!safeAddress) return [];
    const queueUrl = safeWalletQueueUrl(safeAddress, config.deployment);
    const intents = await this.prisma.safePayoutIntent.findMany({
      where: {
        chainId: config.deployment.chainId,
        safeAddress: safeAddress.toLowerCase(),
        OR: [{ delivery: SafePayoutDelivery.MANUAL }, { proposal: { isNot: null } }],
      },
      include: { proposal: true, payout: true, goal: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return intents
      .map((intent) => {
        if (intent.delivery === SafePayoutDelivery.MANUAL) {
          return {
            id: intent.id,
            intentId: intent.id,
            delivery: 'MANUAL' as const,
            goalId: intent.goalId,
            safeAddress: intent.safeAddress,
            safeTxHash: null,
            safeNonce: null,
            status:
              intent.payout.status === PayoutStatus.EXECUTED
                ? ('EXECUTED' as const)
                : intent.payout.status === PayoutStatus.FAILED
                  ? ('CANCELLED' as const)
                  : ('AWAITING_EXECUTION' as const),
            confirmations: null,
            threshold: null,
            executionTxHash: intent.payout.chainTxHash,
            failureReason: null,
            queueUrl,
            goalTitle: intent.goal.title,
            asset: intent.payout.asset,
            kind: intent.payout.kind,
            amountRaw: intent.payout.amountRaw,
            recipientAddress: intent.payout.recipientAddress,
            payoutStatus: intent.payout.status,
            transactionRequest: deploymentTransactionRequest({
              to: getAddress(intent.toAddress),
              value: intent.valueRaw,
              data: intent.data as `0x${string}`,
            }),
            createdAt: intent.createdAt.toISOString(),
            updatedAt: (intent.payout.executedAt ?? intent.updatedAt).toISOString(),
          };
        }
        if (!intent.proposal) return null;
        return this.mapSafeProposal(
          intent.proposal,
          intent,
          intent.payout,
          queueUrl,
          intent.goal.title,
        );
      })
      .filter((item) => item !== null);
  }

  private mapSafeProposal(
    proposal: {
      id: string;
      safeTxHash: string;
      safeNonce: string;
      confirmations: number;
      threshold: number;
      status: SafePayoutProposalStatus;
      executionTxHash: string | null;
      failureReason: string | null;
      createdAt: Date;
      updatedAt: Date;
    },
    intent: { id: string; goalId: string; safeAddress: string },
    payout: {
      asset: FundingAsset;
      kind: PayoutKind;
      amountRaw: string;
      recipientAddress: string;
      status: PayoutStatus;
    },
    queueUrl: string,
    goalTitle?: string,
  ) {
    return {
      id: proposal.id,
      intentId: intent.id,
      delivery: 'SERVICE' as const,
      goalId: intent.goalId,
      safeAddress: intent.safeAddress,
      safeTxHash: proposal.safeTxHash,
      safeNonce: proposal.safeNonce,
      status: proposal.status,
      confirmations: proposal.confirmations,
      threshold: proposal.threshold,
      executionTxHash: proposal.executionTxHash,
      failureReason: proposal.failureReason,
      queueUrl,
      goalTitle: goalTitle ?? null,
      asset: payout.asset,
      kind: payout.kind,
      amountRaw: payout.amountRaw,
      recipientAddress: payout.recipientAddress,
      payoutStatus: payout.status,
      transactionRequest: null,
      createdAt: proposal.createdAt.toISOString(),
      updatedAt: proposal.updatedAt.toISOString(),
    };
  }

  auditLog() {
    return this.prisma.auditEvent.findMany({ take: 100, orderBy: { createdAt: 'desc' } });
  }

  async assignRoles(dto: AssignRolesDto, actor: AuthenticatedPrincipal) {
    if (dto.roles.includes(Role.SUPER_ADMIN)) {
      throw new BadRequestException(
        'SUPER_ADMIN follows the on-chain contract owner and cannot be assigned in the database',
      );
    }
    const project = await this.project();
    const address = getAddress(dto.address).toLowerCase();
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.user.findUnique({ where: { address } });
      const user = await tx.user.upsert({
        where: { address },
        update: { roles: dto.roles },
        create: { address, roles: dto.roles },
      });
      await writeAuditEvent(tx, {
        projectId: project.id,
        actor,
        entityType: 'User',
        entityId: user.id,
        action: 'ASSIGN_ROLES',
        before: { roles: before?.roles ?? [] },
        after: { roles: user.roles },
      });
      return { id: user.id, address: user.address, roles: user.roles };
    });
  }

  async moderateProfile(userId: string, dto: ModerateProfileDto, actor: AuthenticatedPrincipal) {
    const project = await this.project();
    return this.prisma.$transaction(async (tx) => {
      const profile = await tx.sponsorProfile.findUnique({ where: { userId } });
      if (!profile) throw new NotFoundException('Sponsor profile not found');
      const updated = await tx.sponsorProfile.update({
        where: { userId },
        data: { hidden: dto.hidden },
      });
      await writeAuditEvent(tx, {
        projectId: project.id,
        actor,
        entityType: 'SponsorProfile',
        entityId: profile.id,
        action: 'MODERATE',
        before: { hidden: profile.hidden },
        after: { hidden: updated.hidden },
      });
      return updated;
    });
  }
}
