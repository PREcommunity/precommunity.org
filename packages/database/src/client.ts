import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client';

const defaultDatabaseUrl =
  'postgresql://precommunity:precommunity@127.0.0.1:5432/precommunity?schema=public';

export function createPrismaAdapter(databaseUrl = process.env.DATABASE_URL ?? defaultDatabaseUrl) {
  const parsed = new URL(databaseUrl);
  const schema = parsed.searchParams.get('schema') ?? undefined;
  parsed.searchParams.delete('schema');

  return new PrismaPg(
    {
      connectionString: parsed.toString(),
      // Preserve the Prisma 6 connection and idle timeout behavior after moving to node-postgres.
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 300_000,
    },
    schema ? { schema } : undefined,
  );
}

export function createPrismaClient() {
  return new PrismaClient({ adapter: createPrismaAdapter() });
}
