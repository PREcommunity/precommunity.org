import './load-env';
import { prisma } from '@precommunity/database';
import { deploymentStateKey } from '@precommunity/shared';
import { config } from './config';
import { indexEscrow, reconcileEscrow } from './indexer';

async function main() {
  const indexing = await indexEscrow(prisma);
  const reconciliation = await reconcileEscrow(prisma);
  if (
    reconciliation.status === 'RECONCILED' &&
    (!reconciliation.PRE.matches || !reconciliation.USDC.matches)
  ) {
    throw new Error(`Escrow reconciliation mismatch: ${JSON.stringify(reconciliation)}`);
  }
  const [events, authorities, profiles, goals, contributions, state] = await Promise.all([
    prisma.chainEvent.count({ where: { chainId: config.deployment.chainId } }),
    prisma.chainAuthority.findMany({
      where: {
        chainId: config.deployment.chainId,
        contractAddress: config.deployment.escrowAddress.toLowerCase(),
      },
      select: { kind: true, address: true },
      orderBy: [{ kind: 'asc' }, { address: 'asc' }],
    }),
    prisma.sponsorProfile.count({ where: { chainId: config.deployment.chainId } }),
    prisma.fundingGoal.count({ where: { chainId: config.deployment.chainId } }),
    prisma.cryptoContribution.count({ where: { chainId: config.deployment.chainId } }),
    prisma.indexerState.findUnique({
      where: { key: deploymentStateKey(config.deployment) },
      select: { lastBlockNumber: true },
    }),
  ]);
  process.stdout.write(
    `${JSON.stringify(
      {
        indexing,
        reconciliation,
        projection: {
          events,
          authorities,
          profiles,
          goals,
          contributions,
          indexedThroughBlock: state?.lastBlockNumber.toString() ?? null,
        },
      },
      null,
      2,
    )}\n`,
  );
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
