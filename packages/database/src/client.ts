import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client';

const defaultDatabaseUrl =
  'postgresql://precommunity:precommunity@127.0.0.1:5432/precommunity?schema=public';

export function createPrismaAdapter(databaseUrl = process.env.DATABASE_URL ?? defaultDatabaseUrl) {
  const parsed = new URL(databaseUrl);
  const schema = parsed.searchParams.get('schema') ?? undefined;
  parsed.searchParams.delete('schema');
  if (schema) {
    if (schema.includes('\0')) throw new Error('Invalid database schema');
    // Prisma qualifies model queries, but raw SQL also needs this schema on every connection.
    const searchPath = `"${schema.replace(/"/g, '""')}"`.replace(/[\\\s]/g, '\\$&');
    const options = parsed.searchParams.getAll('options').at(-1);
    const trailingBackslashes = options?.match(/\\+$/)?.[0].length ?? 0;
    if (trailingBackslashes % 2 !== 0) throw new Error('Invalid database connection options');
    parsed.searchParams.set(
      'options',
      `${options ? `${options} ` : ''}-c search_path=${searchPath}`,
    );
  }

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
