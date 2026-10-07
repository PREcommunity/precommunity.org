import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { assertSafeKeywordMarketMigration } from './check-keyword-market-migration.mjs';
import { artifactIdentity } from './write-release-manifest.mjs';

test('live deployment refuses a projection reset before stopping the old worker', async () => {
  const client = { query: async () => ({ rows: [{ projection: true, snapshot: false }] }) };
  await assert.rejects(assertSafeKeywordMarketMigration(client), /stopped old worker/);
  for (const row of [
    { projection: false, snapshot: false },
    { projection: true, snapshot: true },
  ]) {
    await assertSafeKeywordMarketMigration({ query: async () => ({ rows: [row] }) });
  }
});

test('release identity records the exact artifact and canonical ABI separately', () => {
  const abi = [{ type: 'function', name: 'stake', inputs: [] }];
  const bytes = Buffer.from(
    JSON.stringify({ abi, deployedBytecode: '0x1234', buildInfoId: 'reviewed-build' }),
  );
  assert.deepEqual(artifactIdentity(bytes), {
    abiSha256: createHash('sha256').update(JSON.stringify(abi)).digest('hex'),
    artifactSha256: createHash('sha256').update(bytes).digest('hex'),
    buildInfoId: 'reviewed-build',
  });
  assert.throws(() => artifactIdentity(Buffer.from('{"abi":[]}')), /incomplete/);
});
