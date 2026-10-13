import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clearMarketRedis,
  MARKET_TABLES,
  PRESERVED_TABLES,
  resetConfiguration,
  resetKeywordMarket,
} from './reset-keyword-market.mjs';

const oldAddress = `0x${'1'.repeat(40)}`;
const newAddress = `0x${'2'.repeat(40)}`;
const env = {
  PRECOMMUNITY_NETWORK: 'base',
  KEYWORD_MARKET_FRESH_START: '1',
  KEYWORD_MARKET_REPLACE_ADDRESS: oldAddress,
  ADS_CONTRACT_ADDRESS: newAddress,
  ADS_CONTRACT_DEPLOYMENT_BLOCK: '123',
  DATABASE_URL:
    'postgresql://precommunity:private-password@127.0.0.1:5432/precommunity?schema=public',
  REDIS_URL: 'redis://:private-password@localhost:6379/0',
  KEYWORD_MARKET_RESET_BACKUP_DIR:
    '/var/backups/precommunity/postgresql/keyword-market-20261012T120000Z',
};

function fixture() {
  const initial = Object.fromEntries(
    [...MARKET_TABLES, ...PRESERVED_TABLES, 'PreUsdPrice'].map((name) => [name, '2']),
  );
  let values = { ...initial };
  let audit = ['AD_CREATIVE_REVISION', 'AdChargeSettings', 'AD_API_KEY', 'FUNDING_GOAL'];
  let snapshot;
  const calls = [];
  const journals = { AdChargeBatch: [], AdPricePublication: [] };
  let corruptPreserved = false;
  const database = {
    async query(sql, parameters) {
      calls.push({ sql, parameters });
      if (sql === 'BEGIN') snapshot = { values: { ...values }, audit: [...audit] };
      else if (sql === 'ROLLBACK') ({ values, audit } = snapshot);
      else if (sql.startsWith('SELECT EXISTS')) {
        const pending = Object.values(journals)
          .flat()
          .some(
            (row) =>
              ['SIGNED', 'SUBMITTED', 'RECONCILING'].includes(row.status) ||
              (row.signedTransaction != null &&
                (row.receiptBlockNumber == null || row.receiptBlockHash == null)),
          );
        return { rows: [{ pending }] };
      } else if (sql.startsWith('SELECT ')) {
        const names = [...sql.matchAll(/SELECT '([^']+)' AS name/g)].map((match) => match[1]);
        return { rows: names.map((name) => ({ name, count: values[name] })) };
      } else if (sql.startsWith('DELETE ')) {
        audit = audit.filter((entity) => !parameters[0].includes(entity));
      } else if (sql.startsWith('TRUNCATE ')) {
        assert.ok(!sql.includes('CASCADE'));
        const names = [...sql.matchAll(/public\."([^']+?)"/g)].map((match) => match[1]);
        assert.deepEqual(names, MARKET_TABLES);
        for (const name of names) values[name] = '0';
        if (corruptPreserved) values.User = '3';
      }
      return { rows: [] };
    },
  };
  const keys = new Set([
    'precommunity:ads:clicks:fixture',
    `bull:precommunity-ad-charges-8453-${oldAddress}:waiting`,
    `bull:precommunity-pre-usd-publication-8453-${oldAddress}:jobs`,
    `bull:precommunity-ad-charges-8453-${newAddress}:waiting`,
    `bull:precommunity-pre-usd-publication-8453-${newAddress}:jobs`,
    'bull:precommunity-price-collector:jobs',
    'precommunity:community:analytics',
  ]);
  const scans = [];
  const unlinks = [];
  const redis = {
    async ping() {
      return 'PONG';
    },
    async scan(cursor, match, pattern, count, batch) {
      scans.push({ cursor, match, pattern, count, batch });
      return ['0', [...keys].filter((key) => key.startsWith(pattern.slice(0, -1)))];
    },
    async unlink(...names) {
      unlinks.push(names);
      let removed = 0;
      for (const name of names) if (keys.delete(name)) removed++;
      return removed;
    },
  };
  const backups = [];
  return {
    database,
    redis,
    calls,
    keys,
    journals,
    scans,
    unlinks,
    backups,
    initial,
    counts: () => values,
    audit: () => audit,
    corruptPreserved: () => {
      corruptPreserved = true;
    },
    run: (overrides = {}) =>
      resetKeywordMarket({
        env,
        database,
        redis,
        readBackup: (dir) => {
          backups.push(dir);
        },
        ...overrides,
      }),
  };
}

test('fresh reset clears only the market, preserves keys/community/prices and targets old Redis queues', async () => {
  const f = fixture();
  const result = await f.run();
  assert.deepEqual(result.cleared, Object.fromEntries(MARKET_TABLES.map((name) => [name, '2'])));
  assert.deepEqual(
    result.preserved,
    Object.fromEntries([...PRESERVED_TABLES, 'PreUsdPrice'].map((name) => [name, '2'])),
  );
  assert.equal(result.redisKeysRemoved, 3);
  for (const name of MARKET_TABLES) assert.equal(f.counts()[name], '0');
  for (const name of [...PRESERVED_TABLES, 'PreUsdPrice']) assert.equal(f.counts()[name], '2');
  assert.deepEqual(f.audit(), ['AD_API_KEY', 'FUNDING_GOAL']);
  assert.deepEqual(f.backups, [env.KEYWORD_MARKET_RESET_BACKUP_DIR]);
  assert.equal(f.calls.at(-1).sql, 'COMMIT');
  assert.equal(f.keys.size, 4);
  assert.ok(f.keys.has(`bull:precommunity-ad-charges-8453-${newAddress}:waiting`));
  assert.ok(f.keys.has('bull:precommunity-price-collector:jobs'));
  assert.ok(
    f.scans.every(
      ({ match, count, batch }) => match === 'MATCH' && count === 'COUNT' && batch === 500,
    ),
  );
  assert.ok(!JSON.stringify(result).includes('private-password'));
});

test('environment guards reject any other network, target, backup or missing explicit fresh flag before access', async () => {
  const cases = [
    { KEYWORD_MARKET_FRESH_START: '0' },
    { PRECOMMUNITY_NETWORK: 'base-sepolia' },
    { KEYWORD_MARKET_REPLACE_ADDRESS: '' },
    { KEYWORD_MARKET_REPLACE_ADDRESS: newAddress },
    { KEYWORD_MARKET_REPLACE_ADDRESS: `0x${'0'.repeat(40)}` },
    { ADS_CONTRACT_ADDRESS: `0x${'0'.repeat(40)}` },
    { ADS_CONTRACT_DEPLOYMENT_BLOCK: '0' },
    { ADS_CONTRACT_DEPLOYMENT_BLOCK: '01' },
    { DATABASE_URL: 'postgresql://precommunity@remote/precommunity' },
    { DATABASE_URL: 'postgresql://postgres@localhost/precommunity' },
    { DATABASE_URL: 'postgresql://precommunity@localhost:5433/precommunity' },
    { DATABASE_URL: 'postgresql://precommunity@localhost/other' },
    { DATABASE_URL: 'postgresql://precommunity@localhost/precommunity?schema=other' },
    { DATABASE_URL: 'postgresql://precommunity@localhost/precommunity?host=remote' },
    { DATABASE_URL: 'postgresql://precommunity@localhost/precommunity?sslmode=require' },
    {
      DATABASE_URL:
        'postgresql://precommunity@localhost/precommunity?sslmode=disable&sslmode=disable',
    },
    { REDIS_URL: 'redis://localhost:6382/0' },
    { REDIS_URL: 'redis://localhost:6379/1' },
    { REDIS_URL: 'redis://localhost:6379/0?db=1' },
    { KEYWORD_MARKET_RESET_BACKUP_DIR: '/tmp/keyword-market-backup' },
    { KEYWORD_MARKET_RESET_BACKUP_DIR: `${env.KEYWORD_MARKET_RESET_BACKUP_DIR}/../other` },
  ];
  for (const change of cases) {
    const f = fixture();
    await assert.rejects(f.run({ env: { ...env, ...change } }));
    assert.equal(f.calls.length, 0);
    assert.equal(f.scans.length, 0);
    assert.equal(f.backups.length, 0);
  }
  assert.equal(
    resetConfiguration({ ...env, DATABASE_URL: 'postgresql://precommunity@localhost/precommunity' })
      .previousAddress,
    oldAddress,
  );
});

test('fresh reset accepts the native production URL with local SSL disabled', async () => {
  const f = fixture();
  await f.run({ env: { ...env, DATABASE_URL: `${env.DATABASE_URL}&sslmode=disable` } });
  assert.equal(f.calls.at(-1).sql, 'COMMIT');
  for (const name of MARKET_TABLES) assert.equal(f.counts()[name], '0');
  for (const name of PRESERVED_TABLES) assert.equal(f.counts()[name], '2');
});

test('missing verified backup aborts before database and Redis cleanup', async () => {
  const f = fixture();
  await assert.rejects(
    f.run({
      readBackup: () => {
        throw new Error('Backup missing');
      },
    }),
    /Backup missing/,
  );
  assert.equal(f.calls.length, 0);
  assert.equal(f.scans.length, 0);
});

test('pending or unproven signed journals refuse reset and roll back without deleting Redis keys', async () => {
  for (const table of ['AdChargeBatch', 'AdPricePublication']) {
    for (const row of [
      { status: 'SIGNED' },
      { status: 'SUBMITTED' },
      { status: 'RECONCILING' },
      {
        status: 'FAILED',
        signedTransaction: '0x1234',
        receiptBlockNumber: null,
        receiptBlockHash: null,
      },
      {
        status: 'SUPERSEDED',
        signedTransaction: '0x1234',
        receiptBlockNumber: 123n,
        receiptBlockHash: null,
      },
    ]) {
      const f = fixture();
      f.journals[table].push(row);
      await assert.rejects(f.run(), /unresolved signed/);
      assert.equal(f.calls.at(-1).sql, 'ROLLBACK');
      assert.ok(!f.calls.some(({ sql }) => sql.startsWith('TRUNCATE')));
      assert.deepEqual(f.counts(), f.initial);
      assert.equal(f.scans.length, 0);
      assert.equal(f.keys.size, 7);
    }
  }
});

test('proven finalized journals can be reset while preservation failures roll the whole database back', async () => {
  const finalized = fixture();
  finalized.journals.AdPricePublication.push({
    status: 'CONFIRMED',
    signedTransaction: '0x1234',
    receiptBlockNumber: 123n,
    receiptBlockHash: '0xhash',
  });
  await finalized.run();
  const f = fixture();
  f.corruptPreserved();
  await assert.rejects(f.run());
  assert.equal(f.calls.at(-1).sql, 'ROLLBACK');
  assert.deepEqual(f.counts(), f.initial);
  assert.deepEqual(f.audit(), [
    'AD_CREATIVE_REVISION',
    'AdChargeSettings',
    'AD_API_KEY',
    'FUNDING_GOAL',
  ]);
  assert.equal(f.scans.length, 0);
});

test('Redis cleanup failure rolls database changes back and cannot commit a partial reset', async () => {
  const f = fixture();
  f.redis.scan = async () => {
    throw new Error('Redis unavailable');
  };
  await assert.rejects(f.run(), /Redis unavailable/);
  assert.equal(f.calls.at(-1).sql, 'ROLLBACK');
  assert.ok(!f.calls.some(({ sql }) => sql === 'COMMIT'));
  assert.deepEqual(f.counts(), f.initial);
});

test('SCAN results are filtered by exact namespace and deletion commands stay bounded', async () => {
  const f = fixture();
  const analytics = Array.from({ length: 503 }, (_, index) => `precommunity:ads:${index}`);
  f.redis.scan = async (_cursor, _match, pattern) => [
    '0',
    pattern === 'precommunity:ads:*' ? [...analytics, 'bull:unrelated:jobs'] : [],
  ];
  await clearMarketRedis(f.redis, oldAddress);
  assert.deepEqual(
    f.unlinks.map((keys) => keys.length),
    [500, 3],
  );
  assert.ok(f.unlinks.flat().every((key) => key.startsWith('precommunity:ads:')));
});
