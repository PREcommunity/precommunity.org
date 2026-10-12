import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEnv } from 'node:util';
import {
  encodedOperatorPair,
  operatorKeystorePair,
  serializeNativeEnv,
} from './operator-keystore-env.mjs';
import {
  buildKeywordRehearsalProfile,
  keywordMarketManifestName,
  REHEARSAL_SCHEMA,
  selectKeywordMarketDeploymentName,
} from './prepare-keyword-market-sepolia.mjs';

const wallet = (digit) => `0x${digit.repeat(40)}`;
const main = {
  DATABASE_URL:
    'postgresql://fixture:private-fixture@127.0.0.1:5432/precommunity?schema=mainnet_cca538',
  DATABASE_URL_TESTNET:
    'postgresql://fixture:private-fixture@127.0.0.1:5432/precommunity?schema=testnet',
  REDIS_URL: 'redis://:private-fixture@127.0.0.1:6379/0?db=0',
  REDIS_URL_TESTNET: 'redis://:private-fixture@127.0.0.1:6379/1',
  PRE_ADDRESS_TESTNET: wallet('1'),
  USDC_ADDRESS_TESTNET: wallet('2'),
  ESCROW_ADDRESS_TESTNET: wallet('3'),
  ESCROW_DEPLOYMENT_BLOCK_TESTNET: '100',
  SAFE_ADDRESS_TESTNET: wallet('4'),
  INITIAL_OWNER_ADDRESS_TESTNET: wallet('5'),
  TREASURY_ADDRESS_TESTNET: wallet('4'),
  SESSION_SECRET: 'a'.repeat(96),
  ADS_REPORT_FINGERPRINT_SECRET: 'b'.repeat(96),
  BASE_RPC_URL_TESTNET: 'https://rpc.example/rpc?key=private-fixture&network=sepolia',
};
const manifest = {
  schema: 'precommunity.keyword-market-deployment.v1',
  stage: 'confirmed',
  network: 'base-sepolia',
  chainId: 84532,
  transactionStatus: 1,
  deploymentBlock: 101,
  requiredConfirmations: 2,
  confirmations: 2,
  preAddress: wallet('1'),
  owner: wallet('4'),
  contractAddress: wallet('6'),
};

test('rehearsal profile isolates both fallback URLs, secrets and real app origins without changing main input', () => {
  const original = structuredClone(main);
  const { env, pendingDeployment } = buildKeywordRehearsalProfile(main);
  assert.deepEqual(main, original);
  assert.equal(pendingDeployment, true);
  assert.equal(new URL(env.DATABASE_URL).searchParams.get('schema'), REHEARSAL_SCHEMA);
  assert.equal(env.DATABASE_URL_TESTNET, env.DATABASE_URL);
  assert.equal(new URL(env.REDIS_URL).pathname, '/2');
  assert.notEqual(new URL(env.REDIS_URL).port, new URL(main.REDIS_URL).port);
  assert.equal(new URL(env.REDIS_URL).username, '');
  assert.equal(new URL(env.REDIS_URL).password, '');
  assert.equal(new URL(env.REDIS_URL).searchParams.has('db'), false);
  assert.equal(env.REDIS_URL_TESTNET, env.REDIS_URL);
  assert.equal(env.PRECOMMUNITY_NETWORK, 'base-sepolia');
  assert.equal(env.NEXT_PUBLIC_PRECOMMUNITY_NETWORK, 'base-sepolia');
  assert.equal(env.CHAIN_CONFIRMATIONS_TESTNET, '12');
  assert.equal(env.PORT, '4012');
  assert.equal(env.SIWE_URI, env.WEB_ORIGIN);
  assert.equal(env.SIWE_DOMAIN, '127.0.0.1:3012');
  assert.equal(env.NEXT_DIST_DIR, '.next-rehearsal');
  assert.equal(env.ADS_CONTRACT_ADDRESS_TESTNET, '');
  assert.equal(env.ADS_OPERATOR_PRIVATE_KEY, '');
  assert.equal(env.BASE_RPC_URL_TESTNET, main.BASE_RPC_URL_TESTNET);
  assert.equal(env.NEXT_PUBLIC_BASE_RPC_URL_TESTNET, 'https://sepolia.base.org');
  assert.notEqual(env.SESSION_SECRET, main.SESSION_SECRET);
  assert.notEqual(env.ADS_REPORT_FINGERPRINT_SECRET, main.ADS_REPORT_FINGERPRINT_SECRET);
  assert.notEqual(env.SESSION_SECRET, env.ADS_REPORT_FINGERPRINT_SECRET);
  const serialized = serializeNativeEnv(env);
  assert.deepEqual(parseEnv(serialized), env);
  const rerun = buildKeywordRehearsalProfile(main, env, manifest);
  assert.equal(rerun.env.SESSION_SECRET, env.SESSION_SECRET);
  assert.equal(rerun.env.ADS_REPORT_FINGERPRINT_SECRET, env.ADS_REPORT_FINGERPRINT_SECRET);
  assert.equal(rerun.pendingDeployment, false);
  assert.equal(rerun.env.ADS_CONTRACT_ADDRESS_TESTNET, manifest.contractAddress);
  assert.equal(rerun.env.ADS_CONTRACT_DEPLOYMENT_BLOCK_TESTNET, '101');
});

test('rehearsal preparation rejects mismatched/pending manifests and unsafe database targets', () => {
  for (const override of [
    { chainId: 8453 },
    { preAddress: wallet('2') },
    { owner: wallet('5') },
    { stage: 'pending' },
    { confirmations: 0 },
    { startPaused: 'false' },
  ]) {
    assert.throws(
      () => buildKeywordRehearsalProfile(main, {}, { ...manifest, ...override }),
      /manifest/i,
    );
  }
  assert.throws(
    () =>
      buildKeywordRehearsalProfile({
        ...main,
        DATABASE_URL: 'postgresql://fixture@remote.example/precommunity',
      }),
    /local service/,
  );
  assert.throws(
    () =>
      buildKeywordRehearsalProfile({
        ...main,
        DATABASE_URL: 'postgresql://fixture@127.0.0.1/another_database',
      }),
    /existing precommunity/,
  );
});

test('a confirmed replacement deployment preserves the rehearsal target and existing secrets', () => {
  const previous = buildKeywordRehearsalProfile(main, {}, manifest).env;
  const replacement = {
    ...manifest,
    contractAddress: wallet('7'),
    deploymentBlock: 102,
    startPaused: false,
  };
  const { env, pendingDeployment } = buildKeywordRehearsalProfile(main, previous, replacement);

  assert.equal(pendingDeployment, false);
  assert.deepEqual(env, {
    ...previous,
    ADS_CONTRACT_ADDRESS_TESTNET: replacement.contractAddress,
    ADS_CONTRACT_DEPLOYMENT_BLOCK_TESTNET: '102',
  });
});

test('CLI selection remembers a named manifest and permits an explicit canonical selection', () => {
  const name = 'active-rehearsal-20261007';
  const selected = selectKeywordMarketDeploymentName(['--deployment-name', name]);
  assert.equal(selected, name);
  assert.equal(keywordMarketManifestName(selected), `base-sepolia.keyword-market-v1.${name}.json`);
  assert.equal(keywordMarketManifestName(''), 'base-sepolia.keyword-market-v1.json');
  const canonical = buildKeywordRehearsalProfile(main, {}, manifest).env;
  const named = buildKeywordRehearsalProfile(main, canonical, manifest, selected).env;
  assert.deepEqual(named, { ...canonical, KEYWORD_MARKET_DEPLOYMENT_NAME_TESTNET: name });
  assert.equal(selectKeywordMarketDeploymentName([], named), name);
  assert.equal(
    buildKeywordRehearsalProfile(main, named, manifest).env.KEYWORD_MARKET_DEPLOYMENT_NAME_TESTNET,
    name,
  );
  assert.equal(selectKeywordMarketDeploymentName(['--deployment-name', ''], named), '');
  assert.throws(() => buildKeywordRehearsalProfile(main, named), /confirmed manifest/);
  for (const invalid of ['../active', '-leading', 'UPPER', 'with space', 'a'.repeat(65)]) {
    assert.throws(() => keywordMarketManifestName(invalid), /Deployment name/);
    assert.throws(
      () => selectKeywordMarketDeploymentName([`--deployment-name=${invalid}`]),
      /Deployment name/,
    );
  }
  assert.throws(() => selectKeywordMarketDeploymentName(['--unknown', 'active']), /Unknown option/);
});

test('copied main secrets and shared rehearsal secrets are replaced independently', () => {
  const previous = {
    SESSION_SECRET: main.ADS_REPORT_FINGERPRINT_SECRET,
    ADS_REPORT_FINGERPRINT_SECRET: main.SESSION_SECRET,
  };
  const { env } = buildKeywordRehearsalProfile(main, previous);
  for (const value of [env.SESSION_SECRET, env.ADS_REPORT_FINGERPRINT_SECRET]) {
    assert.notEqual(value, main.SESSION_SECRET);
    assert.notEqual(value, main.ADS_REPORT_FINGERPRINT_SECRET);
  }
  assert.notEqual(env.SESSION_SECRET, env.ADS_REPORT_FINGERPRINT_SECRET);
});

test('rehearsal preserves its CoinGecko key, falls back to main, and treats whitespace as absent', () => {
  const configured = { ...main, COINGECKO_API_KEY: ' main-fixture ' };
  const { env } = buildKeywordRehearsalProfile(configured);
  assert.equal(env.COINGECKO_API_KEY, 'main-fixture');
  assert.equal(
    buildKeywordRehearsalProfile(configured, { COINGECKO_API_KEY: ' previous-fixture ' }).env
      .COINGECKO_API_KEY,
    'previous-fixture',
  );
  assert.equal(
    buildKeywordRehearsalProfile(configured, { COINGECKO_API_KEY: ' \t ' }).env.COINGECKO_API_KEY,
    'main-fixture',
  );
  assert.equal(
    buildKeywordRehearsalProfile({ ...main, COINGECKO_API_KEY: ' \t ' }).env.COINGECKO_API_KEY,
    '',
  );
  const serialized = serializeNativeEnv(env);
  assert.deepEqual(parseEnv(serialized), env);
  assert.equal('NEXT_PUBLIC_COINGECKO_API_KEY' in env, false);
});

test('rehearsal rejects CoinGecko keys unsafe for environment serialization without exposing them', () => {
  for (const value of [
    'unsafe"fixture',
    'unsafe\\fixture',
    'unsafe\nfixture',
    'unsafe fixture',
    'unsafe$fixture',
  ]) {
    for (const [configured, previous] of [
      [{ ...main, COINGECKO_API_KEY: value }, {}],
      [main, { COINGECKO_API_KEY: value }],
    ]) {
      assert.throws(() => buildKeywordRehearsalProfile(configured, previous), {
        message: 'COINGECKO_API_KEY contains unsupported characters',
      });
    }
  }
});

test('rehearsal preserves only an explicitly configured testnet operator pair with exact password bytes', () => {
  const password = ' leading $ ` " \' \\ / # żółć trailing ';
  const parentPair = { path: '/testnet/operator fixture.json', password };
  const mainnetPair = { path: '/mainnet/operator.json', password: 'mainnet private fixture' };
  const configured = {
    ...main,
    ...encodedOperatorPair(mainnetPair),
    ADS_OPERATOR_KEYSTORE_PATH_TESTNET: parentPair.path,
    ADS_OPERATOR_KEYSTORE_PASSWORD_TESTNET: password,
  };
  const first = buildKeywordRehearsalProfile(configured).env;
  const loaded = parseEnv(serializeNativeEnv(first));
  assert.deepEqual(operatorKeystorePair(loaded, '_TESTNET'), parentPair);
  assert.equal(operatorKeystorePair(loaded), null);
  const rerun = buildKeywordRehearsalProfile(
    {
      ...configured,
      ...encodedOperatorPair({ ...parentPair, password: 'new parent password' }, '_TESTNET'),
    },
    loaded,
  ).env;
  assert.deepEqual(operatorKeystorePair(rerun, '_TESTNET'), parentPair);
  const ownPair = { path: '/testnet/own-operator.json', password: ' own $ ` # password ' };
  const own = buildKeywordRehearsalProfile(
    configured,
    encodedOperatorPair(ownPair, '_TESTNET'),
  ).env;
  assert.deepEqual(operatorKeystorePair(own, '_TESTNET'), ownPair);
  const noFallback = buildKeywordRehearsalProfile({
    ...main,
    ...encodedOperatorPair(mainnetPair),
  }).env;
  assert.equal(operatorKeystorePair(noFallback, '_TESTNET'), null);
});

test('rehearsal isolates updater credentials from mainnet and preserves its own encoded testnet pair on regeneration', () => {
  const prefix = 'ADS_PRICE_UPDATER';
  const parent = {
    path: '/testnet/price updater fixture.json',
    password: ' leading $ ` " \' \\ / # żółć\ntrailing ',
  };
  const mainnet = {
    path: '/mainnet/price updater.json',
    password: 'mainnet private price fixture',
  };
  const operator = { path: '/testnet/operator.json', password: 'separate operator fixture' };
  const configured = {
    ...main,
    ...encodedOperatorPair(mainnet, '', prefix),
    ...encodedOperatorPair(parent, '_TESTNET', prefix),
    ...encodedOperatorPair(operator, '_TESTNET'),
  };
  const first = buildKeywordRehearsalProfile(configured).env;
  const loaded = parseEnv(serializeNativeEnv(first));
  assert.deepEqual(operatorKeystorePair(loaded, '_TESTNET', prefix), parent);
  assert.equal(operatorKeystorePair(loaded, '', prefix), null);
  assert.deepEqual(operatorKeystorePair(loaded, '_TESTNET'), operator);
  const own = { path: '/testnet/own price updater.json', password: ' own private price fixture ' };
  const regenerated = buildKeywordRehearsalProfile(configured, {
    ...loaded,
    ...encodedOperatorPair(own, '_TESTNET', prefix),
  }).env;
  assert.deepEqual(operatorKeystorePair(regenerated, '_TESTNET', prefix), own);
  assert.equal(operatorKeystorePair(regenerated, '', prefix), null);
  const onlyMainnet = buildKeywordRehearsalProfile({
    ...main,
    ...encodedOperatorPair(mainnet, '', prefix),
  }).env;
  assert.equal(operatorKeystorePair(onlyMainnet, '_TESTNET', prefix), null);
  assert.equal(
    Object.keys(first).some((key) => key.startsWith('NEXT_PUBLIC_ADS_PRICE_UPDATER')),
    false,
  );
});

test('rehearsal refuses partial or malformed updater pairs without exposing their credentials', () => {
  for (const pair of [
    { ADS_PRICE_UPDATER_KEYSTORE_PATH_TESTNET: '/private price fixture.json' },
    { ADS_PRICE_UPDATER_KEYSTORE_PASSWORD_TESTNET: 'private price fixture' },
    {
      ADS_PRICE_UPDATER_KEYSTORE_PATH_TESTNET: '/private price fixture.json',
      ADS_PRICE_UPDATER_KEYSTORE_PASSWORD_BASE64_TESTNET: 'invalid private price fixture',
    },
  ]) {
    assert.throws(
      () => buildKeywordRehearsalProfile({ ...main, ...pair }),
      (error) => !error.message.includes('private price fixture'),
    );
  }
});
