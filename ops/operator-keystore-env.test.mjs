import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseEnv } from 'node:util';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  encodedOperatorPair,
  operatorKeystorePair,
  operatorPayload,
  renderOperatorEnvironment,
  serializeNativeEnv,
} from './operator-keystore-env.mjs';

const password = ' leading $ ` " \' \\ / # żółć\ntrailing ';
const pair = { path: '/srv/precommunity/operator fixture.json', password };

test('generated password encoding preserves arbitrary UTF-8 bytes in native env parsing', () => {
  const encoded = encodedOperatorPair(pair, '_TESTNET');
  const parsed = parseEnv(serializeNativeEnv(encoded));
  assert.deepEqual(operatorKeystorePair(parsed, '_TESTNET'), pair);
  assert.equal(parsed.ADS_OPERATOR_KEYSTORE_PASSWORD_TESTNET, '');
});

test('raw password takes precedence without trimming it and no testnet fallback is possible', () => {
  assert.deepEqual(
    operatorKeystorePair({
      ...encodedOperatorPair({ ...pair, password: 'encoded old password' }),
      ADS_OPERATOR_KEYSTORE_PASSWORD: password,
    }),
    pair,
  );
  assert.equal(operatorPayload(encodedOperatorPair(pair), 'base-sepolia'), '');
  assert.equal(operatorKeystorePair({}), null);
});

test('runtime regeneration keeps both pairs and replaces only the selected network', () => {
  const testnet = { path: '/srv/testnet/operator.json', password: ' testnet $ ` # ' };
  const existing = { ...encodedOperatorPair(pair), ...encodedOperatorPair(testnet, '_TESTNET') };
  const untouched = parseEnv(renderOperatorEnvironment(existing, 'base-sepolia'));
  assert.deepEqual(operatorKeystorePair(untouched), pair);
  assert.deepEqual(operatorKeystorePair(untouched, '_TESTNET'), testnet);
  const replacement = { path: '/srv/testnet/replacement.json', password };
  const payload = operatorPayload(encodedOperatorPair(replacement, '_TESTNET'), 'base-sepolia');
  const changed = parseEnv(renderOperatorEnvironment(existing, 'base-sepolia', payload));
  assert.deepEqual(operatorKeystorePair(changed), pair);
  assert.deepEqual(operatorKeystorePair(changed, '_TESTNET'), replacement);
  assert.throws(() => renderOperatorEnvironment(existing, 'base', payload), /selected network/);
});

test('partial pairs and invalid encoding are rejected without exposing password contents', () => {
  for (const env of [
    { ADS_OPERATOR_KEYSTORE_PATH: pair.path },
    { ADS_OPERATOR_KEYSTORE_PASSWORD: password },
    {
      ADS_OPERATOR_KEYSTORE_PATH: pair.path,
      ADS_OPERATOR_KEYSTORE_PASSWORD_BASE64: 'bad encoding',
    },
  ]) {
    assert.throws(
      () => operatorKeystorePair(env),
      (error) => !error.message.includes(password),
    );
  }
});

test('native profile serialization preserves quotes and backslashes rather than JSON escaping', () => {
  const env = {
    PATH_FIXTURE: '/some "quoted" path\\file',
    PASSWORD_FIXTURE: " 'quoted' $ ` # \\ ",
  };
  assert.deepEqual(parseEnv(serializeNativeEnv(env)), env);
});

test('price updater credentials are independent and preserve both network pairs', () => {
  const prefix = 'ADS_PRICE_UPDATER';
  const mainnet = encodedOperatorPair(pair, '', prefix);
  const testnetPair = { path: '/srv/testnet/price.json', password: ' price $ ` # ' };
  const existing = {
    ...mainnet,
    ...encodedOperatorPair(testnetPair, '_TESTNET', prefix),
    ...encodedOperatorPair(pair),
  };
  const payload = operatorPayload(existing, 'base-sepolia', prefix);
  const rendered = parseEnv(renderOperatorEnvironment(existing, 'base-sepolia', payload, prefix));
  assert.deepEqual(operatorKeystorePair(rendered, '', prefix), pair);
  assert.deepEqual(operatorKeystorePair(rendered, '_TESTNET', prefix), testnetPair);
  assert.equal(operatorKeystorePair(rendered), null);
  assert.equal(operatorPayload(mainnet, 'base-sepolia', prefix), '');
  assert.throws(() =>
    operatorKeystorePair({ ADS_PRICE_UPDATER_KEYSTORE_PATH: pair.path }, '', prefix),
  );
});

test('updater replacement changes only the selected network and raw password wins over the encoded value', () => {
  const prefix = 'ADS_PRICE_UPDATER';
  const mainnet = { path: '/mainnet/price.json', password: 'main private price fixture' };
  const testnet = { path: '/testnet/price.json', password };
  const existing = {
    ...encodedOperatorPair(mainnet, '', prefix),
    ...encodedOperatorPair(testnet, '_TESTNET', prefix),
  };
  const replacement = {
    path: '/testnet/price next.json',
    password: ' next private price fixture ',
  };
  const payload = operatorPayload(
    encodedOperatorPair(replacement, '_TESTNET', prefix),
    'base-sepolia',
    prefix,
  );
  const rendered = parseEnv(renderOperatorEnvironment(existing, 'base-sepolia', payload, prefix));
  assert.deepEqual(operatorKeystorePair(rendered, '', prefix), mainnet);
  assert.deepEqual(operatorKeystorePair(rendered, '_TESTNET', prefix), replacement);
  assert.deepEqual(
    operatorKeystorePair(
      {
        ...encodedOperatorPair(testnet, '_TESTNET', prefix),
        ADS_PRICE_UPDATER_KEYSTORE_PASSWORD_TESTNET: password,
      },
      '_TESTNET',
      prefix,
    ),
    testnet,
  );
  assert.throws(
    () => renderOperatorEnvironment(existing, 'base', payload, prefix),
    /selected network/,
  );
});

test('updater CLI rejects invalid operations, networks, pairs and payloads without secret output', () => {
  const helper = fileURLToPath(new URL('./operator-keystore-env.mjs', import.meta.url));
  for (const [args, env, input] of [
    [['price-invalid', 'base'], {}, ''],
    [['price-payload', 'wrong-network'], encodedOperatorPair(pair, '', 'ADS_PRICE_UPDATER'), ''],
    [
      ['price-payload', 'base'],
      { ADS_PRICE_UPDATER_KEYSTORE_PATH: '/private price fixture.json' },
      '',
    ],
    [
      ['price-payload', 'base'],
      {
        ADS_PRICE_UPDATER_KEYSTORE_PATH: pair.path,
        ADS_PRICE_UPDATER_KEYSTORE_PASSWORD_BASE64: 'invalid private price fixture',
      },
      '',
    ],
    [
      ['price-render', 'base'],
      {},
      JSON.stringify({
        network: 'base-sepolia',
        path: pair.path,
        passwordBase64: Buffer.from(password).toString('base64'),
      }),
    ],
    [['price-render', 'base'], {}, 'broken private price fixture'],
  ]) {
    const result = spawnSync(process.execPath, [helper, ...args], {
      encoding: 'utf8',
      input,
      env: { ...env },
    });
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, '');
    for (const secret of [
      password,
      Buffer.from(password).toString('base64'),
      'private price fixture',
      pair.path,
    ])
      assert.equal(result.stderr.includes(secret), false);
  }
});
