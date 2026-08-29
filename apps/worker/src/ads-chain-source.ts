import type { PrismaClient } from '@precommunity/database';
import { config } from './config';

export interface AdsChainSourceStatus {
  status: 'AWAITING_CONTRACT' | 'SYNCING' | 'SYNCED';
  chainId: number;
  contractAddress: string | null;
  deploymentBlock: string | null;
}

/** Phase-one adapter. A reviewed ABI-specific source replaces this implementation later. */
export class AwaitingContractAdsChainSource {
  status(): AdsChainSourceStatus {
    return {
      status: 'AWAITING_CONTRACT',
      chainId: config.deployment.chainId,
      contractAddress: config.adsContract.address,
      deploymentBlock: config.adsContract.deploymentBlock,
    };
  }

  async index(_prisma: PrismaClient) {
    return { processed: 0, ...this.status() };
  }
}

export const adsChainSource = new AwaitingContractAdsChainSource();

export function indexAds(prisma: PrismaClient) {
  return adsChainSource.index(prisma);
}
