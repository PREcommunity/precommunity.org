import {
  SafeGoalManagerProposalStatus,
  desiredGoalManagerSet,
  reconcileSafeOwnerGoalManagerAssignments,
  type PrismaClient,
} from '@precommunity/database';
import SafeApiKit from '@safe-global/api-kit';
import { createPublicClient, getAddress, http, keccak256, toHex } from 'viem';
import { config } from './config';
import {
  classifyMissingSafeSubmission,
  classifySafeProposal,
  executedSafeTransactionsAtNonce,
  safeTransactionsAtNonce,
  shouldRecoverMissingSafeSubmission,
} from './safe-proposals';

const pendingStatuses: SafeGoalManagerProposalStatus[] = [
  SafeGoalManagerProposalStatus.SUBMITTING,
  SafeGoalManagerProposalStatus.AWAITING_CONFIRMATIONS,
  SafeGoalManagerProposalStatus.READY_TO_EXECUTE,
];

const changedPolicyWarning =
  'Safe owners or manual goal manager settings changed. Cancel or replace this proposal at its current nonce in Safe before preparing another sync.';

const safeOwnersAbi = [
  {
    type: 'function',
    name: 'getOwners',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address[]' }],
  },
] as const;

const publicClient = createPublicClient({
  chain: config.chain,
  transport: http(config.BASE_RPC_URL),
});

function currentSafeOwners() {
  if (!config.SAFE_ADDRESS) return Promise.resolve([]);
  return publicClient.readContract({
    address: getAddress(config.SAFE_ADDRESS),
    abi: safeOwnersAbi,
    functionName: 'getOwners',
  });
}

function service() {
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

function desiredStateHash(addresses: Iterable<string>) {
  const normalized = [...new Set([...addresses].map((address) => address.toLowerCase()))].sort();
  return keccak256(toHex(JSON.stringify(normalized)));
}

function transactionServiceEnabled() {
  return Boolean(
    config.SAFE_ADDRESS &&
    (config.SAFE_TRANSACTION_SERVICE_API_KEY || config.SAFE_TRANSACTION_SERVICE_URL),
  );
}

export async function syncSafeGoalManagerPolicy(prisma: PrismaClient) {
  if (!config.SAFE_ADDRESS) return { status: 'DISABLED' as const };
  const safeOwners = await currentSafeOwners();
  const result = await reconcileSafeOwnerGoalManagerAssignments(prisma, {
    chainId: config.deployment.chainId,
    contractAddress: config.deployment.escrowAddress,
    safeOwners: [...safeOwners],
  });
  return { status: 'SYNCED' as const, ...result };
}

async function currentDesiredHash(prisma: PrismaClient, safeOwners: string[]) {
  const scope = {
    chainId: config.deployment.chainId,
    contractAddress: config.deployment.escrowAddress.toLowerCase(),
  };
  const [actualRows, assignments] = await Promise.all([
    prisma.chainAuthority.findMany({
      where: { ...scope, kind: 'GOAL_MANAGER' },
      select: { address: true },
    }),
    prisma.goalManagerAssignment.findMany({ where: scope }),
  ]);
  return desiredStateHash(
    desiredGoalManagerSet(
      safeOwners,
      actualRows.map((row) => row.address),
      assignments,
    ),
  );
}

export async function syncSafeGoalManagerProposals(prisma: PrismaClient) {
  if (!transactionServiceEnabled() || !config.SAFE_ADDRESS) {
    return { status: 'DISABLED' as const, checked: 0 };
  }
  const safe = service();
  const [info, safeOwners] = await Promise.all([
    safe.getSafeInfo(getAddress(config.SAFE_ADDRESS)),
    currentSafeOwners(),
  ]);
  const desiredHash = await currentDesiredHash(prisma, [...safeOwners]);
  const pending = await prisma.safeGoalManagerProposal.findMany({
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
  let updated = 0;
  const now = new Date();
  for (const proposal of pending) {
    const policyChanged = proposal.intent.desiredStateHash !== desiredHash;
    try {
      const transaction = await safe.getTransaction(proposal.safeTxHash);
      let resolvedTransaction = transaction;
      let nonceWasReplaced = false;
      if (!transaction.isExecuted && BigInt(proposal.safeNonce) < BigInt(info.nonce)) {
        const executedAtNonce = await executedSafeTransactionsAtNonce(
          safe,
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
        BigInt(info.nonce),
        proposal.threshold,
        now,
        nonceWasReplaced,
      );
      const terminal =
        next.status === 'EXECUTED' || next.status === 'STALE' || next.status === 'FAILED';
      const changed = await prisma.safeGoalManagerProposal.updateMany({
        where: { id: proposal.id, status: { in: pendingStatuses } },
        data: {
          ...next,
          status: next.status as unknown as SafeGoalManagerProposalStatus,
          failureReason: policyChanged && !terminal ? changedPolicyWarning : next.failureReason,
          ...(terminal ? { activeKey: null } : {}),
          lastCheckedAt: now,
        },
      });
      updated += changed.count;
    } catch (error) {
      if (shouldRecoverMissingSafeSubmission(proposal as never, BigInt(info.nonce), error, now)) {
        const transactionsAtNonce = await safeTransactionsAtNonce(
          safe,
          config.SAFE_ADDRESS,
          proposal.safeNonce,
        );
        if (transactionsAtNonce === null) {
          await prisma.safeGoalManagerProposal.updateMany({
            where: { id: proposal.id, status: { in: pendingStatuses } },
            data: {
              failureReason: policyChanged
                ? changedPolicyWarning
                : 'Safe status is temporarily unavailable',
              lastCheckedAt: now,
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
            BigInt(info.nonce),
            proposal.threshold,
            now,
          );
          const terminal =
            next.status === 'EXECUTED' || next.status === 'STALE' || next.status === 'FAILED';
          const changed = await prisma.safeGoalManagerProposal.updateMany({
            where: { id: proposal.id, status: { in: pendingStatuses } },
            data: {
              ...next,
              status: next.status as unknown as SafeGoalManagerProposalStatus,
              failureReason: policyChanged && !terminal ? changedPolicyWarning : next.failureReason,
              ...(terminal ? { activeKey: null } : {}),
              lastCheckedAt: now,
            },
          });
          updated += changed.count;
          continue;
        }
        const missing = classifyMissingSafeSubmission(
          proposal.safeNonce,
          BigInt(info.nonce),
          nonceWasReplaced,
        );
        const terminal = missing.status === 'STALE' || missing.status === 'FAILED';
        const changed = await prisma.safeGoalManagerProposal.updateMany({
          where: { id: proposal.id, status: { in: pendingStatuses } },
          data: {
            status: missing.status as unknown as SafeGoalManagerProposalStatus,
            ...(terminal ? { activeKey: null } : {}),
            failureReason:
              policyChanged && !terminal ? changedPolicyWarning : missing.failureReason,
            lastCheckedAt: now,
          },
        });
        updated += changed.count;
      } else {
        await prisma.safeGoalManagerProposal.updateMany({
          where: { id: proposal.id, status: { in: pendingStatuses } },
          data: {
            failureReason: policyChanged
              ? changedPolicyWarning
              : 'Safe status is temporarily unavailable',
            lastCheckedAt: now,
          },
        });
      }
    }
  }
  return { status: 'SYNCED' as const, checked: pending.length, updated };
}
