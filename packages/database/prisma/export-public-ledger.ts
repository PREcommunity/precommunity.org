import { loadEnvFile } from 'node:process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { SponsorVisibility } from '../src/generated/prisma/client';
import { createPrismaClient } from '../src/client';

try {
  loadEnvFile(path.resolve(__dirname, '../../../.env'));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}

const outputPath = process.env.ESCROW_LEDGER_EXPORT_PATH;
if (!outputPath || !path.isAbsolute(outputPath)) {
  throw new Error('ESCROW_LEDGER_EXPORT_PATH must be an absolute, new output file path.');
}
const ledgerExportPath = outputPath;
const network = process.env.PRECOMMUNITY_NETWORK;
const chainId = network === 'base' ? 8453 : network === 'base-sepolia' ? 84532 : null;
if (chainId === null) throw new Error('PRECOMMUNITY_NETWORK must be base or base-sepolia.');
const ledgerChainId = chainId;

const prisma = createPrismaClient();

async function main() {
  const goals = await prisma.fundingGoal.findMany({
    where: { chainId: ledgerChainId },
    select: {
      chainId: true,
      chainGoalId: true,
      creatorAddress: true,
      goalType: true,
      monthlySurplusPolicy: true,
      monthlyStopRequestedAt: true,
      monthlyPeriodsSettled: true,
      slug: true,
      monthStart: true,
      title: true,
      description: true,
      recipientAddress: true,
      deadline: true,
      metadataUri: true,
      metadataStatus: true,
      metadata: true,
      preTargetRaw: true,
      usdcTargetRaw: true,
      preRecipientEntitlementRaw: true,
      usdcRecipientEntitlementRaw: true,
      preCarryRaw: true,
      usdcCarryRaw: true,
      preTreasuryEntitlementRaw: true,
      usdcTreasuryEntitlementRaw: true,
      status: true,
      creationTxHash: true,
      creationBlock: true,
      creationBlockHash: true,
      publishedAt: true,
      closedAt: true,
      periods: { orderBy: { periodIndex: 'asc' } },
      contributions: {
        select: {
          asset: true,
          amountRaw: true,
          visibility: true,
          contributor: true,
          txHash: true,
          logIndex: true,
          blockNumber: true,
          blockHash: true,
          confirmedAt: true,
        },
        orderBy: [{ blockNumber: 'asc' }, { logIndex: 'asc' }],
      },
      payouts: {
        select: {
          asset: true,
          kind: true,
          amountRaw: true,
          recipientAddress: true,
          chainTxHash: true,
          status: true,
          executedAt: true,
        },
        orderBy: { createdAt: 'asc' },
      },
    },
    orderBy: [{ creationBlock: 'asc' }, { chainGoalId: 'asc' }],
  });
  const publicGoals = goals.map((goal) => ({
    ...goal,
    contributions: goal.contributions.map((contribution) => ({
      ...contribution,
      contributor:
        contribution.visibility === SponsorVisibility.PUBLIC ? contribution.contributor : null,
    })),
  }));
  const document = {
    schema: 'precommunity.public-ledger-export.v1',
    exportedAt: new Date().toISOString(),
    retiredEscrowAddress: process.env.RETIRED_ESCROW_ADDRESS ?? null,
    chainId: ledgerChainId,
    goals: publicGoals,
  };
  await writeFile(
    ledgerExportPath,
    `${JSON.stringify(document, (_, value) => (typeof value === 'bigint' ? value.toString() : value), 2)}\n`,
    { encoding: 'utf8', flag: 'wx', mode: 0o600 },
  );
  process.stdout.write(
    `${JSON.stringify({ outputPath: ledgerExportPath, chainId: ledgerChainId, goals: goals.length, exportedAt: document.exportedAt })}\n`,
  );
}

main()
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
