import {
  FundingAsset,
  PayoutKind,
  PayoutStatus,
  type Prisma,
  type PrismaClient,
  SafePayoutProposalStatus,
  expireUnconsumedSafePayoutIntents,
} from '@precommunity/database';
import SafeApiKit from '@safe-global/api-kit';
import { getAddress } from 'viem';
import { config } from './config';

function apiKit() {
  return new SafeApiKit({
    chainId: BigInt(config.deployment.chainId),
    ...(config.SAFE_TRANSACTION_SERVICE_URL
      ? { txServiceUrl: config.SAFE_TRANSACTION_SERVICE_URL }
      : {}),
    ...(config.SAFE_TRANSACTION_SERVICE_API_KEY
      ? { apiKey: config.SAFE_TRANSACTION_SERVICE_API_KEY }
      : {}),
  });
}

interface SafeTransactionSnapshot {
  confirmations?: readonly unknown[];
  confirmationsRequired: number;
  isExecuted: boolean;
  isSuccessful: boolean | null;
  transactionHash: string | null;
  executionDate: string | null;
}

type SafeTransactionAtNonce = Awaited<
  ReturnType<SafeApiKit['getMultisigTransactions']>
>['results'][number];

export async function safeTransactionsAtNonce(
  service: Pick<SafeApiKit, 'getMultisigTransactions'>,
  safeAddress: string,
  nonce: string,
  executedOnly = false,
): Promise<SafeTransactionAtNonce[] | null> {
  try {
    const history = await service.getMultisigTransactions(getAddress(safeAddress), {
      ...(executedOnly ? { executed: true } : {}),
      nonce,
      limit: 100,
    });
    return history.results.filter(
      (transaction) =>
        (!executedOnly || transaction.isExecuted) && BigInt(transaction.nonce) === BigInt(nonce),
    );
  } catch {
    return null;
  }
}

export async function executedSafeTransactionsAtNonce(
  service: Pick<SafeApiKit, 'getMultisigTransactions'>,
  safeAddress: string,
  nonce: string,
): Promise<SafeTransactionAtNonce[]> {
  return (await safeTransactionsAtNonce(service, safeAddress, nonce, true)) ?? [];
}

export const SAFE_SUBMITTING_RECOVERY_DELAY_MS = 15 * 60_000;

const pendingSafeProposalStatuses: SafePayoutProposalStatus[] = [
  SafePayoutProposalStatus.SUBMITTING,
  SafePayoutProposalStatus.AWAITING_CONFIRMATIONS,
  SafePayoutProposalStatus.READY_TO_EXECUTE,
];

type SafeProposalWriter = Pick<Prisma.TransactionClient, 'payout' | 'safePayoutProposal'>;

export async function applyPendingSafeProposalUpdate(
  transaction: SafeProposalWriter,
  proposalId: string,
  payoutId: string,
  data: Prisma.SafePayoutProposalUpdateManyMutationInput,
  failPayout = false,
) {
  const changed = await transaction.safePayoutProposal.updateMany({
    where: { id: proposalId, status: { in: pendingSafeProposalStatuses } },
    data,
  });
  if (changed.count !== 1) return false;

  if (failPayout) {
    await transaction.payout.updateMany({
      where: { id: payoutId, status: PayoutStatus.PROPOSED },
      data: { status: PayoutStatus.FAILED },
    });
  }
  return true;
}

export function shouldRecoverMissingSafeSubmission(
  proposal: { status: SafePayoutProposalStatus; safeNonce: string; createdAt: Date },
  _currentNonce: bigint,
  error: unknown,
  now = new Date(),
) {
  const statusCode =
    typeof error === 'object' && error !== null && 'statusCode' in error
      ? (error as { statusCode?: unknown }).statusCode
      : undefined;
  return (
    proposal.status === SafePayoutProposalStatus.SUBMITTING &&
    statusCode === 404 &&
    now.getTime() - proposal.createdAt.getTime() >= SAFE_SUBMITTING_RECOVERY_DELAY_MS
  );
}

export function classifyMissingSafeSubmission(
  proposalNonce: string,
  currentNonce: bigint,
  nonceWasReplaced = false,
) {
  if (nonceWasReplaced) {
    return {
      status: SafePayoutProposalStatus.STALE,
      failureReason: 'A different executed Safe transaction used this nonce',
    };
  }
  if (BigInt(proposalNonce) < currentNonce) {
    return {
      status: SafePayoutProposalStatus.SUBMITTING,
      failureReason: 'Safe nonce advanced; awaiting verified execution or replacement',
    };
  }
  return {
    status: SafePayoutProposalStatus.FAILED,
    failureReason: 'The signed proposal did not reach the Safe Transaction Service',
  };
}

export function classifySafeProposal(
  transaction: SafeTransactionSnapshot,
  proposalNonce: string,
  currentNonce: bigint,
  fallbackThreshold: number,
  now = new Date(),
  nonceWasReplaced = false,
) {
  const confirmations = transaction.confirmations?.length ?? 0;
  const threshold = transaction.confirmationsRequired || fallbackThreshold;
  let status: SafePayoutProposalStatus =
    confirmations >= threshold
      ? SafePayoutProposalStatus.READY_TO_EXECUTE
      : SafePayoutProposalStatus.AWAITING_CONFIRMATIONS;
  let failureReason: string | null = null;
  let executionTxHash: string | null = null;
  let executedAt: Date | null = null;

  if (transaction.isExecuted) {
    executionTxHash = transaction.transactionHash?.toLowerCase() ?? null;
    if (transaction.isSuccessful === true) {
      status = SafePayoutProposalStatus.EXECUTED;
      executedAt = transaction.executionDate ? new Date(transaction.executionDate) : now;
    } else if (transaction.isSuccessful === false) {
      status = SafePayoutProposalStatus.FAILED;
      failureReason = 'Safe transaction execution failed';
      executedAt = transaction.executionDate ? new Date(transaction.executionDate) : now;
    } else {
      failureReason = 'Safe execution result is not available yet';
    }
  } else if (nonceWasReplaced) {
    status = SafePayoutProposalStatus.STALE;
    failureReason = 'A different executed Safe transaction used this nonce';
  } else if (BigInt(proposalNonce) < currentNonce) {
    failureReason = 'Safe nonce advanced; awaiting verified execution or replacement';
  }

  return { confirmations, threshold, status, failureReason, executionTxHash, executedAt };
}

interface SafePayoutIdentity {
  id: string;
  goalId: string;
  asset: FundingAsset;
  kind: PayoutKind;
  amountRaw: string;
  recipientAddress: string;
}

export async function reconcileConfirmedSafePayout(
  transaction: SafeProposalWriter,
  payout: SafePayoutIdentity,
  executionTxHash: string,
) {
  const normalizedHash = executionTxHash.toLowerCase();
  const confirmedProjection = await transaction.payout.findFirst({
    where: {
      id: { not: payout.id },
      goalId: payout.goalId,
      asset: payout.asset,
      kind: payout.kind,
      amountRaw: payout.amountRaw,
      recipientAddress: payout.recipientAddress,
      chainTxHash: normalizedHash,
      status: PayoutStatus.EXECUTED,
      safeIntent: { is: null },
    },
    select: { id: true, recipientAddress: true, executedAt: true },
  });
  if (!confirmedProjection) return false;

  const promoted = await transaction.payout.updateMany({
    where: { id: payout.id, status: PayoutStatus.PROPOSED },
    data: {
      status: PayoutStatus.EXECUTED,
      chainTxHash: normalizedHash,
      recipientAddress: confirmedProjection.recipientAddress,
      executedAt: confirmedProjection.executedAt,
    },
  });
  if (promoted.count !== 1) return false;

  await transaction.payout.delete({ where: { id: confirmedProjection.id } });
  return true;
}

export async function syncSafePayoutProposals(prisma: PrismaClient) {
  if (
    !config.SAFE_ADDRESS ||
    (!config.SAFE_TRANSACTION_SERVICE_API_KEY && !config.SAFE_TRANSACTION_SERVICE_URL)
  ) {
    return { status: 'DISABLED' as const, checked: 0 };
  }

  const now = new Date();
  const expired = await expireUnconsumedSafePayoutIntents(
    prisma,
    {
      chainId: config.deployment.chainId,
      safeAddress: config.SAFE_ADDRESS,
    },
    now,
  );

  const unresolvedExecutedPayouts = await prisma.safePayoutProposal.findMany({
    where: {
      status: SafePayoutProposalStatus.EXECUTED,
      executionTxHash: { not: null },
      intent: {
        chainId: config.deployment.chainId,
        safeAddress: config.SAFE_ADDRESS.toLowerCase(),
        payout: { status: PayoutStatus.PROPOSED },
      },
    },
    include: { intent: { include: { payout: true } } },
    orderBy: { updatedAt: 'asc' },
    take: 100,
  });
  let reconciled = 0;
  for (const proposal of unresolvedExecutedPayouts) {
    if (
      await prisma.$transaction((tx) =>
        reconcileConfirmedSafePayout(tx, proposal.intent.payout, proposal.executionTxHash!),
      )
    ) {
      reconciled += 1;
    }
  }

  const pending = await prisma.safePayoutProposal.findMany({
    where: {
      status: {
        in: pendingSafeProposalStatuses,
      },
      intent: {
        chainId: config.deployment.chainId,
        safeAddress: config.SAFE_ADDRESS.toLowerCase(),
      },
    },
    include: { intent: { include: { payout: true } } },
    orderBy: { updatedAt: 'asc' },
    take: 100,
  });
  if (!pending.length) {
    return { status: 'SYNCED' as const, checked: 0, reconciled, expired };
  }

  const service = apiKit();
  const safeInfo = await service.getSafeInfo(getAddress(config.SAFE_ADDRESS));
  const currentNonce = BigInt(safeInfo.nonce);
  let updated = 0;

  for (const proposal of pending) {
    try {
      const transaction = await service.getTransaction(proposal.safeTxHash);
      let resolvedTransaction = transaction;
      let nonceWasReplaced = false;
      if (!transaction.isExecuted && BigInt(proposal.safeNonce) < currentNonce) {
        const executedAtNonce = await executedSafeTransactionsAtNonce(
          service,
          config.SAFE_ADDRESS,
          proposal.safeNonce,
        );
        const ownExecution = executedAtNonce.find(
          (candidate) => candidate.safeTxHash.toLowerCase() === proposal.safeTxHash.toLowerCase(),
        );
        if (ownExecution) resolvedTransaction = ownExecution;
        else nonceWasReplaced = executedAtNonce.length > 0;
      }
      const next = classifySafeProposal(
        resolvedTransaction,
        proposal.safeNonce,
        currentNonce,
        proposal.threshold,
        now,
        nonceWasReplaced,
      );

      const changed = await prisma.$transaction(async (tx) => {
        const proposalChanged = await applyPendingSafeProposalUpdate(
          tx,
          proposal.id,
          proposal.intent.payoutId,
          { ...next, lastCheckedAt: now },
          next.status === SafePayoutProposalStatus.FAILED ||
            next.status === SafePayoutProposalStatus.STALE,
        );
        if (
          proposalChanged &&
          next.status === SafePayoutProposalStatus.EXECUTED &&
          next.executionTxHash
        ) {
          await reconcileConfirmedSafePayout(tx, proposal.intent.payout, next.executionTxHash);
        }
        return proposalChanged;
      });
      if (changed) updated += 1;
    } catch (error) {
      if (shouldRecoverMissingSafeSubmission(proposal, currentNonce, error, now)) {
        const transactionsAtNonce = await safeTransactionsAtNonce(
          service,
          config.SAFE_ADDRESS,
          proposal.safeNonce,
        );
        if (transactionsAtNonce === null) {
          await prisma.safePayoutProposal.updateMany({
            where: { id: proposal.id, status: { in: pendingSafeProposalStatuses } },
            data: {
              lastCheckedAt: now,
              failureReason: 'Safe status is temporarily unavailable',
            },
          });
          continue;
        }
        const ownExecution = transactionsAtNonce.find(
          (candidate) =>
            candidate.isExecuted &&
            candidate.safeTxHash.toLowerCase() === proposal.safeTxHash.toLowerCase(),
        );
        const nonceWasReplaced =
          !ownExecution &&
          transactionsAtNonce.some(
            (candidate) =>
              candidate.isExecuted &&
              candidate.safeTxHash.toLowerCase() !== proposal.safeTxHash.toLowerCase(),
          );
        const ownTransaction =
          ownExecution ??
          (!nonceWasReplaced
            ? transactionsAtNonce.find(
                (candidate) =>
                  candidate.safeTxHash.toLowerCase() === proposal.safeTxHash.toLowerCase(),
              )
            : undefined);
        if (ownTransaction) {
          const next = classifySafeProposal(
            ownTransaction,
            proposal.safeNonce,
            currentNonce,
            proposal.threshold,
            now,
          );
          const changed = await prisma.$transaction(async (tx) => {
            const proposalChanged = await applyPendingSafeProposalUpdate(
              tx,
              proposal.id,
              proposal.intent.payoutId,
              { ...next, lastCheckedAt: now },
              next.status === SafePayoutProposalStatus.FAILED,
            );
            if (
              proposalChanged &&
              next.status === SafePayoutProposalStatus.EXECUTED &&
              next.executionTxHash
            ) {
              await reconcileConfirmedSafePayout(tx, proposal.intent.payout, next.executionTxHash);
            }
            return proposalChanged;
          });
          if (changed) updated += 1;
          continue;
        }
        const missingSubmission = classifyMissingSafeSubmission(
          proposal.safeNonce,
          currentNonce,
          nonceWasReplaced,
        );
        const changed = await prisma.$transaction((tx) =>
          applyPendingSafeProposalUpdate(
            tx,
            proposal.id,
            proposal.intent.payoutId,
            {
              status: missingSubmission.status,
              lastCheckedAt: now,
              failureReason: missingSubmission.failureReason,
            },
            missingSubmission.status === SafePayoutProposalStatus.FAILED ||
              missingSubmission.status === SafePayoutProposalStatus.STALE,
          ),
        );
        if (changed) updated += 1;
      } else {
        await prisma.safePayoutProposal.updateMany({
          where: { id: proposal.id, status: { in: pendingSafeProposalStatuses } },
          data: {
            lastCheckedAt: now,
            failureReason: 'Safe status is temporarily unavailable',
          },
        });
      }
    }
  }

  return {
    status: 'SYNCED' as const,
    checked: pending.length,
    updated,
    reconciled,
    expired,
  };
}
