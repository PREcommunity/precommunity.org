import './load-env';
import { prisma } from '@precommunity/database';
import { deploymentStateKey } from '@precommunity/shared';
import { config } from './config';
import { adsIndexerStateKey } from './ads-projection';
import { indexAds } from './ads-chain-source';
import { indexEscrow, reconcileEscrow } from './indexer';
import { createPublicClient, http } from 'viem';
import { keywordMarketCheckPhase, verifyKeywordMarketReadiness } from './keyword-market-readiness';

async function main() {
  const phase = keywordMarketCheckPhase(process.argv.slice(2));
  const indexing = await indexEscrow(prisma);
  const reconciliation = await reconcileEscrow(prisma);
  const keywordMarketIndexing = await indexAds(prisma);
  let keywordMarketReadiness = null;
  if (config.adsContract.address) {
    if (keywordMarketIndexing.status !== 'SYNCED')
      throw new Error('Keyword Market backfill did not reach SYNCED');
    keywordMarketReadiness = await verifyKeywordMarketReadiness(
      createPublicClient({ chain: config.chain, transport: http(config.BASE_RPC_URL) }),
      prisma,
      {
        chainId: config.deployment.chainId,
        contractAddress: config.adsContract.address,
        deploymentBlock: config.adsContract.deploymentBlock,
        preAddress: config.deployment.preAddress,
        safeAddress: config.SAFE_ADDRESS,
        confirmations: config.deployment.confirmations,
        phase,
      },
    );
  }
  if (
    reconciliation.status === 'RECONCILED' &&
    (!reconciliation.PRE.matches || !reconciliation.USDC.matches)
  ) {
    throw new Error(`Escrow reconciliation mismatch: ${JSON.stringify(reconciliation)}`);
  }
  const marketIdentity = config.adsContract.address
    ? {
        chainId: config.deployment.chainId,
        contractAddress: config.adsContract.address.toLowerCase(),
      }
    : null;
  const [
    events,
    authorities,
    profiles,
    goals,
    contributions,
    state,
    marketEvents,
    marketPositions,
    marketState,
  ] = await Promise.all([
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
    marketIdentity ? prisma.adChainEvent.count({ where: marketIdentity }) : 0,
    marketIdentity ? prisma.adStakePosition.count({ where: marketIdentity }) : 0,
    marketIdentity
      ? prisma.adIndexerState.findUnique({
          where: { key: adsIndexerStateKey(marketIdentity) },
          select: { lastBlockNumber: true },
        })
      : null,
  ]);
  process.stdout.write(
    `${JSON.stringify(
      {
        indexing,
        reconciliation,
        keywordMarketIndexing,
        keywordMarketReadiness,
        projection: {
          events,
          authorities,
          profiles,
          goals,
          contributions,
          indexedThroughBlock: state?.lastBlockNumber.toString() ?? null,
        },
        keywordMarketProjection: {
          events: marketEvents,
          positions: marketPositions,
          indexedThroughBlock: marketState?.lastBlockNumber.toString() ?? null,
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
