import {
  FundingAsset,
  MetadataStatus,
  PayoutStatus,
  Prisma,
  resetChainProjection,
  type PrismaClient,
} from '@precommunity/database';
import {
  PRECOMMUNITY_ESCROW_ABI,
  deploymentStateKey,
  isDeploymentConfigured,
  isValidIpfsUri,
} from '@precommunity/shared';
import { erc20Abi, createPublicClient, getAddress, http } from 'viem';
import { z } from 'zod';
import { config } from './config';
import {
  handleDecodedEscrowEvent,
  isIndexableProfileEventArgs,
  type MetadataRefresh,
} from './event-handlers';
import { verifyEscrowManifest } from './escrow-manifest';

export {
  applyAuthorityChange,
  applyProfileClear,
  applyProfileUpdate,
  resetProfileProjectionAfterReorg,
  slugFor,
  visibilityForContribution,
} from './event-handlers';

const client = createPublicClient({ chain: config.chain, transport: http(config.BASE_RPC_URL) });
const stateKey = deploymentStateKey(config.deployment);
const contractAddress = config.deployment.escrowAddress.toLowerCase();
let verifiedManifestKey: string | null = null;

export async function ensureEscrowManifest() {
  if (!isDeploymentConfigured(config.deployment)) return null;
  if (verifiedManifestKey === stateKey) return { status: 'VERIFIED' as const };
  const verified = await verifyEscrowManifest(client, config.deployment, config.SAFE_ADDRESS);
  verifiedManifestKey = stateKey;
  return { status: 'VERIFIED' as const, ...verified };
}

const metadataSchema = z
  .object({
    schema: z.literal('precommunity.goal-metadata.v1'),
    category: z.string().trim().min(1).max(80).optional(),
    subproject: z
      .object({
        name: z.string().trim().min(1).max(80),
        slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      })
      .strict()
      .optional(),
    discussionUrl: z
      .string()
      .url()
      .refine((value) => value.startsWith('https://') || value.startsWith('http://'))
      .optional(),
    documents: z
      .array(
        z
          .object({
            label: z.string().trim().min(1).max(120),
            url: z
              .string()
              .url()
              .refine((value) => value.startsWith('https://') || value.startsWith('http://')),
          })
          .strict(),
      )
      .max(20)
      .optional(),
  })
  .strict();

export function confirmedHead(
  head: bigint,
  deploymentBlock = BigInt(config.deployment.deploymentBlock),
  confirmations = BigInt(config.deployment.confirmations),
) {
  return head < deploymentBlock + confirmations ? null : head - confirmations;
}

export function chainReorganized(storedHash: string, canonicalHash: string) {
  return storedHash.toLowerCase() !== canonicalHash.toLowerCase();
}

export function compareEscrowLogs(
  left: { blockNumber: bigint; logIndex: number },
  right: { blockNumber: bigint; logIndex: number },
) {
  if (left.blockNumber !== right.blockNumber) return left.blockNumber < right.blockNumber ? -1 : 1;
  return left.logIndex - right.logIndex;
}

export async function claimChainEvent(
  database: Pick<Prisma.TransactionClient, 'chainEvent'>,
  data: Prisma.ChainEventCreateManyInput,
) {
  const inserted = await database.chainEvent.createMany({ data: [data], skipDuplicates: true });
  return inserted.count === 1;
}

export async function refreshGoalMetadata(
  prisma: PrismaClient,
  goalId: string,
  metadataUri: string,
) {
  if (!metadataUri) {
    await prisma.fundingGoal.update({
      where: { id: goalId },
      data: { metadataStatus: MetadataStatus.NOT_SET, metadata: Prisma.DbNull },
    });
    return MetadataStatus.NOT_SET;
  }
  if (!isValidIpfsUri(metadataUri)) {
    await prisma.fundingGoal.update({
      where: { id: goalId },
      data: { metadataStatus: MetadataStatus.INVALID, metadata: Prisma.DbNull },
    });
    return MetadataStatus.INVALID;
  }
  const path = metadataUri.slice('ipfs://'.length).split('/').map(encodeURIComponent).join('/');
  try {
    const response = await fetch(new URL(path, config.IPFS_GATEWAY_URL), {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(config.IPFS_TIMEOUT_MS),
    });
    const declaredLength = Number(response.headers.get('content-length') ?? '0');
    if (!response.ok || declaredLength > 262_144)
      throw new Error(`IPFS gateway returned ${response.status}`);
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > 262_144) throw new Error('IPFS metadata exceeds 256 KiB');
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    const parsed = metadataSchema.safeParse(json);
    if (!parsed.success) {
      await prisma.fundingGoal.update({
        where: { id: goalId },
        data: { metadataStatus: MetadataStatus.INVALID, metadata: Prisma.DbNull },
      });
      return MetadataStatus.INVALID;
    }
    await prisma.fundingGoal.update({
      where: { id: goalId },
      data: { metadataStatus: MetadataStatus.AVAILABLE, metadata: parsed.data },
    });
    return MetadataStatus.AVAILABLE;
  } catch {
    await prisma.fundingGoal.update({
      where: { id: goalId },
      data: { metadataStatus: MetadataStatus.UNAVAILABLE, metadata: Prisma.DbNull },
    });
    return MetadataStatus.UNAVAILABLE;
  }
}

export async function retryUnavailableMetadata(prisma: PrismaClient, limit = 20) {
  const goals = await prisma.fundingGoal.findMany({
    where: {
      chainId: config.deployment.chainId,
      creationTxHash: { not: null },
      metadataStatus: MetadataStatus.UNAVAILABLE,
      metadataUri: { not: null },
    },
    select: { id: true, metadataUri: true },
    orderBy: { updatedAt: 'asc' },
    take: limit,
  });
  const statuses = await Promise.all(
    goals.map((goal) => refreshGoalMetadata(prisma, goal.id, goal.metadataUri!)),
  );
  return {
    attempted: goals.length,
    recovered: statuses.filter((status) => status === MetadataStatus.AVAILABLE).length,
  };
}

async function rebuildAfterReorg(prisma: PrismaClient) {
  await prisma.$transaction((tx) =>
    resetChainProjection(tx, {
      chainId: config.deployment.chainId,
      contractAddress,
    }),
  );
}

export async function indexEscrow(prisma: PrismaClient) {
  if (!isDeploymentConfigured(config.deployment))
    return { processed: 0, status: 'AWAITING_DEPLOYMENT' as const };
  await ensureEscrowManifest();
  const head = await client.getBlockNumber();
  const confirmations = BigInt(config.deployment.confirmations);
  const deploymentBlock = BigInt(config.deployment.deploymentBlock);
  const safeHead = confirmedHead(head, deploymentBlock, confirmations);
  if (safeHead === null)
    return { processed: 0, status: 'AWAITING_CONFIRMATIONS' as const, head: head.toString() };
  let state = await prisma.indexerState.findUnique({ where: { key: stateKey } });
  let fromBlock = state ? state.lastBlockNumber + 1n : deploymentBlock;

  if (state) {
    const canonical = await client.getBlock({ blockNumber: state.lastBlockNumber });
    if (chainReorganized(state.lastBlockHash, canonical.hash)) {
      await rebuildAfterReorg(prisma);
      state = null;
      fromBlock = deploymentBlock;
      console.warn(
        JSON.stringify({
          level: 'warn',
          service: 'precommunity-worker',
          event: 'chain_reorg',
          rebuildFrom: deploymentBlock.toString(),
        }),
      );
    }
  }

  if (fromBlock > safeHead)
    return {
      processed: 0,
      status: 'SYNCED' as const,
      indexedThroughBlock: state?.lastBlockNumber.toString() ?? null,
    };
  let processed = 0;
  for (let start = fromBlock; start <= safeHead; start += 2_000n) {
    const end = start + 1_999n > safeHead ? safeHead : start + 1_999n;
    const logs = (
      await client.getContractEvents({
        address: getAddress(config.deployment.escrowAddress),
        abi: PRECOMMUNITY_ESCROW_ABI,
        fromBlock: start,
        toBlock: end,
        strict: true,
      })
    ).sort(compareEscrowLogs);
    const blocks = new Map<bigint, Awaited<ReturnType<typeof client.getBlock>>>();
    for (const log of logs) {
      const txHash = log.transactionHash.toLowerCase() as `0x${string}`;
      if (
        log.eventName === 'ProfileUpdated' &&
        !isIndexableProfileEventArgs(log.args as unknown as Record<string, unknown>)
      ) {
        console.warn(
          JSON.stringify({
            level: 'warn',
            service: 'precommunity-worker',
            event: 'malformed_profile_skipped',
            blockNumber: log.blockNumber.toString(),
            txHash,
            logIndex: log.logIndex,
          }),
        );
        continue;
      }
      let block = blocks.get(log.blockNumber);
      if (!block) {
        block = await client.getBlock({ blockNumber: log.blockNumber });
        blocks.set(log.blockNumber, block);
      }
      const payload = JSON.parse(
        JSON.stringify(log.args, (_, value) =>
          typeof value === 'bigint' ? value.toString() : value,
        ),
      );
      let metadataRefresh: MetadataRefresh | null = null;
      let claimed = false;

      await prisma.$transaction(async (tx) => {
        claimed = await claimChainEvent(tx, {
          chainId: config.deployment.chainId,
          txHash,
          logIndex: log.logIndex,
          blockNumber: log.blockNumber,
          blockHash: log.blockHash,
          eventName: log.eventName,
          payload,
        });
        if (!claimed) return;

        metadataRefresh = await handleDecodedEscrowEvent(tx, {
          eventName: log.eventName,
          args: log.args as unknown as Record<string, unknown>,
          blockNumber: log.blockNumber,
          blockHash: log.blockHash,
          blockTimestamp: block!.timestamp,
          txHash,
          logIndex: log.logIndex,
        });
      });
      if (!claimed) continue;
      const pendingMetadata = metadataRefresh as { goalId: string; uri: string } | null;
      if (pendingMetadata)
        await refreshGoalMetadata(prisma, pendingMetadata.goalId, pendingMetadata.uri);
      processed += 1;
    }
    const indexedBlock = await client.getBlock({ blockNumber: end });
    await prisma.indexerState.upsert({
      where: { key: stateKey },
      update: { lastBlockNumber: end, lastBlockHash: indexedBlock.hash },
      create: {
        key: stateKey,
        chainId: config.deployment.chainId,
        lastBlockNumber: end,
        lastBlockHash: indexedBlock.hash,
      },
    });
  }
  return { processed, status: 'SYNCED' as const, indexedThroughBlock: safeHead.toString() };
}

export async function reconcileEscrow(prisma: PrismaClient) {
  if (!isDeploymentConfigured(config.deployment)) return { status: 'AWAITING_DEPLOYMENT' as const };
  await ensureEscrowManifest();
  const [preBalance, usdcBalance, contributions, payouts] = await Promise.all([
    client.readContract({
      address: getAddress(config.deployment.preAddress),
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [getAddress(config.deployment.escrowAddress)],
    }),
    client.readContract({
      address: getAddress(config.deployment.usdcAddress),
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [getAddress(config.deployment.escrowAddress)],
    }),
    prisma.cryptoContribution.findMany({ where: { chainId: config.deployment.chainId } }),
    prisma.payout.findMany({
      where: { status: PayoutStatus.EXECUTED, goal: { chainId: config.deployment.chainId } },
    }),
  ]);
  const expected = (asset: FundingAsset) =>
    contributions
      .filter((item) => item.asset === asset)
      .reduce((sum, item) => sum + BigInt(item.amountRaw), 0n) -
    payouts
      .filter((item) => item.asset === asset)
      .reduce((sum, item) => sum + BigInt(item.amountRaw), 0n);
  return {
    status: 'RECONCILED' as const,
    PRE: {
      onChain: preBalance.toString(),
      expected: expected(FundingAsset.PRE).toString(),
      matches: preBalance === expected(FundingAsset.PRE),
    },
    USDC: {
      onChain: usdcBalance.toString(),
      expected: expected(FundingAsset.USDC).toString(),
      matches: usdcBalance === expected(FundingAsset.USDC),
    },
  };
}
