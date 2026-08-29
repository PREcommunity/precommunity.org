import { loadEnvFile } from 'node:process';
import path from 'node:path';
import { defineConfig, env } from 'prisma/config';

for (const environmentPath of [
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), '../../.env'),
]) {
  if (process.env.DATABASE_URL) break;
  try {
    loadEnvFile(environmentPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

if (
  process.env.PRECOMMUNITY_NETWORK === 'base-sepolia' &&
  process.env.DATABASE_URL_TESTNET?.trim()
) {
  process.env.DATABASE_URL = process.env.DATABASE_URL_TESTNET.trim();
}

process.env.DATABASE_URL ??=
  'postgresql://precommunity:precommunity@127.0.0.1:5432/precommunity?schema=public';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
