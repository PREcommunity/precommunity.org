import { PrismaClient } from './generated/prisma/client';
import { createPrismaAdapter } from './client';

const globalDatabase = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalDatabase.prisma ??
  new PrismaClient({
    adapter: createPrismaAdapter(),
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalDatabase.prisma = prisma;

export * from './generated/prisma/client';
export { createPrismaAdapter, createPrismaClient } from './client';
export { resetChainProjection } from './projection-reset';
export {
  escrowCutoverDeploymentEnvKeys,
  escrowCutoverBlockers,
  hasEscrowCutoverBlockers,
  resetForEscrowCutover,
} from './escrow-cutover';
export type { EscrowCutoverNetwork } from './escrow-cutover';
export { resetAdsProjection } from './ads-projection';
export { expireUnconsumedSafePayoutIntents } from './safe-payout-intents';
export { readApplicationFeatures } from './application-features';
export type { ApplicationFeatures } from './application-features';
export {
  desiredGoalManagerSet,
  reconcileSafeOwnerGoalManagerAssignments,
} from './goal-manager-assignments';
