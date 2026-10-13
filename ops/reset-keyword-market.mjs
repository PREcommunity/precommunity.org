import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

export const MARKET_TABLES = [
  'AdBillingClick',
  'AdChargeBatch',
  'AdChargeRun',
  'AdChargeSettings',
  'AdPricePublication',
  'AdStakePosition',
  'AdChainEvent',
  'AdIndexerState',
  'AdReport',
  'AdReportAggregate',
  'AdDailyMetric',
  'AdMetricFlush',
  'AdCreativeRevision',
  'AdCampaign',
];
export const PRESERVED_TABLES = ['User', 'FundingGoal', 'CryptoContribution', 'AdApiKey'];
const tableNames = (tables) => tables.map((name) => `public."${name}"`).join(', ');

class ResetRefused extends Error {}

export function resetConfiguration(env) {
  if (env.PRECOMMUNITY_NETWORK !== 'base' || env.KEYWORD_MARKET_FRESH_START !== '1') {
    throw new ResetRefused('Reset requires Base mainnet and KEYWORD_MARKET_FRESH_START=1.');
  }
  const previousAddress = env.KEYWORD_MARKET_REPLACE_ADDRESS?.toLowerCase();
  const contractAddress = env.ADS_CONTRACT_ADDRESS?.toLowerCase();
  const address = /^0x[a-f0-9]{40}$/;
  if (
    !address.test(previousAddress ?? '') ||
    !address.test(contractAddress ?? '') ||
    /^0x0{40}$/.test(previousAddress) ||
    /^0x0{40}$/.test(contractAddress) ||
    previousAddress === contractAddress ||
    !/^[1-9]\d*$/.test(env.ADS_CONTRACT_DEPLOYMENT_BLOCK ?? '')
  ) {
    throw new ResetRefused(
      'Reset requires the previous nonzero market and a different deployed target.',
    );
  }
  let database;
  let redis;
  try {
    database = new URL(env.DATABASE_URL);
    redis = new URL(env.REDIS_URL);
  } catch {
    throw new ResetRefused('Reset requires the expected local database and Redis URLs.');
  }
  if (
    database.protocol !== 'postgresql:' ||
    !['localhost', '127.0.0.1'].includes(database.hostname) ||
    !['', '5432'].includes(database.port) ||
    database.pathname !== '/precommunity' ||
    database.username !== 'precommunity' ||
    database.hash ||
    [...database.searchParams.keys()].some((key) => !['schema', 'sslmode'].includes(key)) ||
    database.searchParams.getAll('schema').length > 1 ||
    ![null, 'public'].includes(database.searchParams.get('schema')) ||
    database.searchParams.getAll('sslmode').length > 1 ||
    ![null, 'disable'].includes(database.searchParams.get('sslmode'))
  ) {
    throw new ResetRefused(
      'Reset database must be the local precommunity/public production target.',
    );
  }
  if (
    redis.protocol !== 'redis:' ||
    !['localhost', '127.0.0.1'].includes(redis.hostname) ||
    !['', '6379'].includes(redis.port) ||
    !['', '/', '/0'].includes(redis.pathname) ||
    redis.search ||
    redis.hash
  ) {
    throw new ResetRefused('Reset Redis must be the local production database 0.');
  }
  const backupDir = env.KEYWORD_MARKET_RESET_BACKUP_DIR;
  if (
    !/^\/var\/backups\/precommunity\/postgresql\/keyword-market-[a-zA-Z0-9_-]+$/.test(
      backupDir ?? '',
    )
  ) {
    throw new ResetRefused('Reset requires its verified Keyword Market backup directory.');
  }
  return { previousAddress, contractAddress, backupDir };
}

export function verifyBackup(backupDir) {
  // The caller already verified pg_restore; these files are readable only through sudo.
  try {
    execFileSync('sudo', ['-n', 'test', '-d', backupDir], { stdio: 'ignore' });
    for (const file of ['database/precommunity.dump', 'checksums.sha256']) {
      execFileSync('sudo', ['-n', 'test', '-s', `${backupDir}/${file}`], { stdio: 'ignore' });
    }
  } catch {
    throw new ResetRefused('The verified database dump or checksum file is missing or unreadable.');
  }
}

async function counts(database, tables) {
  const { rows } = await database.query(
    tables
      .map((name) => `SELECT '${name}' AS name, count(*)::text AS count FROM public."${name}"`)
      .join(' UNION ALL '),
  );
  const result = Object.fromEntries(rows.map((row) => [row.name, row.count]));
  for (const name of tables) {
    if (!/^\d+$/.test(result[name] ?? ''))
      throw new ResetRefused('Reset could not verify table counts.');
  }
  return result;
}

export async function clearMarketRedis(redis, previousAddress) {
  const prefixes = [
    'precommunity:ads:',
    `bull:precommunity-ad-charges-8453-${previousAddress}:`,
    `bull:precommunity-pre-usd-publication-8453-${previousAddress}:`,
  ];
  let removed = 0;
  for (const prefix of prefixes) {
    let cursor = '0';
    let pages = 0;
    do {
      if (++pages > 10_000) throw new ResetRefused('Redis cleanup exceeded its bounded scan.');
      const [next, found] = await redis.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 500);
      if (!/^\d+$/.test(next) || !Array.isArray(found)) {
        throw new ResetRefused('Redis cleanup returned an invalid scan.');
      }
      const keys = found.filter((key) => typeof key === 'string' && key.startsWith(prefix));
      for (let offset = 0; offset < keys.length; offset += 500) {
        removed += await redis.unlink(...keys.slice(offset, offset + 500));
      }
      cursor = next;
    } while (cursor !== '0');
  }
  return removed;
}

export async function resetKeywordMarket({ env, database, redis, readBackup = verifyBackup }) {
  const configuration = resetConfiguration(env);
  await readBackup(configuration.backupDir);
  if ((await redis.ping()) !== 'PONG') throw new ResetRefused('Reset Redis is unavailable.');
  await database.query('BEGIN');
  try {
    await database.query(
      `LOCK TABLE ${tableNames([...MARKET_TABLES, ...PRESERVED_TABLES, 'PreUsdPrice', 'AuditEvent'])} IN ACCESS EXCLUSIVE MODE`,
    );
    const { rows } = await database.query(`SELECT EXISTS (
      SELECT 1 FROM public."AdChargeBatch"
      WHERE "status" IN ('SIGNED', 'SUBMITTED', 'RECONCILING')
         OR ("signedTransaction" IS NOT NULL AND ("receiptBlockNumber" IS NULL OR "receiptBlockHash" IS NULL))
      UNION ALL
      SELECT 1 FROM public."AdPricePublication"
      WHERE "status" IN ('SIGNED', 'SUBMITTED', 'RECONCILING')
         OR ("signedTransaction" IS NOT NULL AND ("receiptBlockNumber" IS NULL OR "receiptBlockHash" IS NULL))
    ) AS pending`);
    if (rows[0]?.pending !== false) {
      throw new ResetRefused(
        'Reset refused: unresolved signed charge or price-publication journals remain.',
      );
    }
    const preserved = await counts(database, [...PRESERVED_TABLES, 'PreUsdPrice']);
    const cleared = await counts(database, MARKET_TABLES);
    await database.query(`DELETE FROM public."AuditEvent" WHERE "entityType" = ANY($1::text[])`, [
      ['AD_CREATIVE_REVISION', 'AdChargeSettings'],
    ]);
    await database.query(`TRUNCATE TABLE ${tableNames(MARKET_TABLES)}`);
    const empty = await counts(database, MARKET_TABLES);
    if (Object.values(empty).some((count) => BigInt(count) !== 0n)) {
      throw new ResetRefused('Reset did not empty all Keyword Market tables.');
    }
    assert.deepEqual(await counts(database, [...PRESERVED_TABLES, 'PreUsdPrice']), preserved);
    const redisKeysRemoved = await clearMarketRedis(redis, configuration.previousAddress);
    await database.query('COMMIT');
    return { cleared, preserved, redisKeysRemoved };
  } catch (error) {
    await database.query('ROLLBACK');
    throw error;
  }
}

async function main() {
  const env = process.env;
  const configuration = resetConfiguration(env);
  verifyBackup(configuration.backupDir);
  const databaseRequire = createRequire(
    new URL('../packages/database/package.json', import.meta.url),
  );
  const workerRequire = createRequire(new URL('../apps/worker/package.json', import.meta.url));
  const { Client } = databaseRequire('pg');
  const Redis = workerRequire('ioredis');
  const database = new Client({
    connectionString: env.DATABASE_URL,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
  });
  const redis = new Redis(env.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
    commandTimeout: 10_000,
  });
  redis.on('error', () => {});
  try {
    await database.connect();
    await redis.connect();
    const result = await resetKeywordMarket({ env, database, redis, readBackup: () => {} });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    redis.disconnect();
    await database.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof ResetRefused ? error.message : 'Keyword Market reset failed; keep maintenance active and services stopped.'}\n`,
    );
    process.exitCode = 1;
  });
}
