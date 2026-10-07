import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export async function assertSafeKeywordMarketMigration(client, schema = 'public') {
  const { rows } = await client.query(
    `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'AdStakePosition') AS projection,
            EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'AdStakePosition' AND column_name = 'requiredCoveragePreRaw') AS snapshot`,
    [schema],
  );
  if (rows[0].projection && !rows[0].snapshot) {
    throw new Error(
      'Keyword Market projection reset requires PRECOMMUNITY_KEYWORD_MARKET_RELEASE=1 and a stopped old worker. No migrations were applied.',
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const require = createRequire(path.resolve('packages/database/package.json'));
  const { Client } = require('pg');
  const selectedUrl =
    process.env.PRECOMMUNITY_NETWORK === 'base-sepolia' && process.env.DATABASE_URL_TESTNET?.trim()
      ? process.env.DATABASE_URL_TESTNET.trim()
      : process.env.DATABASE_URL;
  const url = new URL(selectedUrl);
  const schema = url.searchParams.get('schema') ?? 'public';
  url.searchParams.delete('schema');
  const client = new Client({ connectionString: url.href });
  try {
    await client.connect();
    await assertSafeKeywordMarketMigration(client, schema);
  } finally {
    await client.end();
  }
}
