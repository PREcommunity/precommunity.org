import { Prisma, SafeGoalActionProposalStatus, type PrismaClient } from '@precommunity/database';
import { getAddress } from 'viem';
import { config } from './config';
import {
  classifyMissingSafeSubmission,
  classifySafeProposal,
  createSafeApiKit,
  resolveSafeTransaction,
  safeTransactionsAtNonce,
  shouldRecoverMissingSafeSubmission,
} from './safe-proposals';

const pendingStatuses: SafeGoalActionProposalStatus[] = [
  SafeGoalActionProposalStatus.SUBMITTING,
  SafeGoalActionProposalStatus.AWAITING_CONFIRMATIONS,
  SafeGoalActionProposalStatus.READY_TO_EXECUTE,
];

async function applyStatusUpdate(
  prisma: PrismaClient,
  proposal: { id: string; status: SafeGoalActionProposalStatus },
  data: Prisma.SafeGoalActionProposalUpdateManyMutationInput,
) {
  return prisma.$transaction(async (tx) => {
    const changed = await tx.safeGoalActionProposal.updateMany({
      where: { id: proposal.id, status: { in: pendingStatuses } },
      data,
    });
    if (changed.count) {
      await tx.auditEvent.create({
        data: {
          actorAddress: null,
          entityType: 'SafeGoalActionProposal',
          entityId: proposal.id,
          action: 'SYNC_SAFE_GOAL_ACTION_STATUS',
          before: { status: proposal.status },
          after: {
            status: String(data.status ?? proposal.status),
            executionTxHash: data.executionTxHash ?? null,
            failureReason: data.failureReason ?? null,
          },
        },
      });
    }
    return changed;
  });
}

export async function syncSafeGoalActionProposals(prisma: PrismaClient) {
  if (
    !config.SAFE_ADDRESS ||
    (!config.SAFE_TRANSACTION_SERVICE_API_KEY && !config.SAFE_TRANSACTION_SERVICE_URL)
  ) {
    return { status: 'DISABLED' as const, checked: 0 };
  }

  const pending = await prisma.safeGoalActionProposal.findMany({
    where: {
      status: { in: pendingStatuses },
      intent: {
        chainId: config.deployment.chainId,
        safeAddress: config.SAFE_ADDRESS.toLowerCase(),
      },
    },
    include: { intent: true },
    orderBy: { updatedAt: 'asc' },
    take: 100,
  });
  if (!pending.length) return { status: 'SYNCED' as const, checked: 0, updated: 0 };

  const safe = createSafeApiKit();
  const info = await safe.getSafeInfo(getAddress(config.SAFE_ADDRESS));
  const currentNonce = BigInt(info.nonce);
  const now = new Date();
  let updated = 0;

  for (const proposal of pending) {
    try {
      const { transaction: resolved, nonceWasReplaced } = await resolveSafeTransaction(
        safe,
        config.SAFE_ADDRESS,
        proposal,
        currentNonce,
      );
      const next = classifySafeProposal(
        resolved,
        proposal.safeNonce,
        currentNonce,
        proposal.threshold,
        now,
        nonceWasReplaced,
      );
      const changed = await applyStatusUpdate(prisma, proposal, {
        ...next,
        status: next.status as unknown as SafeGoalActionProposalStatus,
        lastCheckedAt: now,
      });
      updated += changed.count;
    } catch (error) {
      if (shouldRecoverMissingSafeSubmission(proposal as never, currentNonce, error, now)) {
        const atNonce = await safeTransactionsAtNonce(
          safe,
          config.SAFE_ADDRESS,
          proposal.safeNonce,
        );
        if (atNonce !== null) {
          const own = atNonce.find(
            (candidate) => candidate.safeTxHash.toLowerCase() === proposal.safeTxHash.toLowerCase(),
          );
          const replaced =
            !own &&
            atNonce.some(
              (candidate) =>
                candidate.isExecuted &&
                candidate.safeTxHash.toLowerCase() !== proposal.safeTxHash.toLowerCase(),
            );
          const next = own
            ? classifySafeProposal(own, proposal.safeNonce, currentNonce, proposal.threshold, now)
            : classifyMissingSafeSubmission(proposal.safeNonce, currentNonce, replaced);
          const changed = await applyStatusUpdate(prisma, proposal, {
            ...next,
            status: next.status as unknown as SafeGoalActionProposalStatus,
            lastCheckedAt: now,
          });
          updated += changed.count;
          continue;
        }
      }
      await applyStatusUpdate(prisma, proposal, {
        failureReason: 'Safe status is temporarily unavailable',
        lastCheckedAt: now,
      });
    }
  }

  return { status: 'SYNCED' as const, checked: pending.length, updated };
}
