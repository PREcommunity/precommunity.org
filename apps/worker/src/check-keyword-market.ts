import './load-env';
import { prisma } from '@precommunity/database';
import { createPublicClient, http } from 'viem';
import { config } from './config';
import { keywordMarketCheckPhase, verifyKeywordMarketReadiness } from './keyword-market-readiness';

async function main() {
  const result = await verifyKeywordMarketReadiness(
    createPublicClient({ chain: config.chain, transport: http(config.BASE_RPC_URL) }),
    prisma,
    {
      chainId: config.deployment.chainId,
      contractAddress: config.adsContract.address,
      deploymentBlock: config.adsContract.deploymentBlock,
      preAddress: config.deployment.preAddress,
      safeAddress: config.SAFE_ADDRESS,
      confirmations: config.deployment.confirmations,
      phase: keywordMarketCheckPhase(process.argv.slice(2), 'active'),
    },
  );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main()
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
