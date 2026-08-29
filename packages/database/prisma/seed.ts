import { loadEnvFile } from 'node:process';
import path from 'node:path';
import { createPrismaClient } from '../src/client';

try {
  loadEnvFile(path.resolve(__dirname, '../../../.env'));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}

if (
  process.env.PRECOMMUNITY_NETWORK === 'base-sepolia' &&
  process.env.DATABASE_URL_TESTNET?.trim()
) {
  process.env.DATABASE_URL = process.env.DATABASE_URL_TESTNET.trim();
}

const prisma = createPrismaClient();

async function main() {
  const project = await prisma.project.upsert({
    where: { slug: 'precommunity' },
    update: {
      name: 'precommunity',
      description: 'Independent community funding with public proof on Base.',
    },
    create: {
      slug: 'precommunity',
      name: 'precommunity',
      description: 'Independent community funding with public proof on Base.',
    },
  });

  await prisma.subproject.upsert({
    where: { projectId_slug: { projectId: project.id, slug: 'general' } },
    update: {
      name: 'General',
      archivedAt: null,
    },
    create: {
      projectId: project.id,
      slug: 'general',
      name: 'General',
      description: 'Default group for goals without a dedicated subproject.',
    },
  });

  await prisma.communitySettings.upsert({
    where: { projectId: project.id },
    update: {},
    create: {
      projectId: project.id,
      forumTopicModerationEnabled: false,
      keywordMarketEnabled: false,
    },
  });
}

main().finally(() => prisma.$disconnect());
