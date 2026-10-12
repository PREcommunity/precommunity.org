import { describe, expect, it } from 'vitest';
import { resolveServerConfig, serverConfigSchema } from './server-config';

const address = '0x1111111111111111111111111111111111111111';
const deployment = {
  PUBLIC_ESCROW_ADDRESS: address,
  PUBLIC_ESCROW_DEPLOYMENT_BLOCK: '100',
  PUBLIC_PRE_ADDRESS: address,
  PUBLIC_USDC_ADDRESS: address,
  PUBLIC_INITIAL_OWNER_ADDRESS: address,
  PUBLIC_TREASURY_ADDRESS: address,
};

describe('shared backend configuration', () => {
  it('selects only the active network price updater and keeps its password bytes independent from the operator', () => {
    const password = ' leading $ ` " \' \\ / # żółć\ntrailing ';
    const env = {
      ...deployment,
      ADS_OPERATOR_KEYSTORE_PATH_TESTNET: '/operator-test.json',
      ADS_OPERATOR_KEYSTORE_PASSWORD_TESTNET: 'operator fixture',
      ADS_PRICE_UPDATER_KEYSTORE_PATH: '/price-main.json',
      ADS_PRICE_UPDATER_KEYSTORE_PASSWORD: 'main price fixture',
      ADS_PRICE_UPDATER_KEYSTORE_PATH_TESTNET: '/price-test.json',
      ADS_PRICE_UPDATER_KEYSTORE_PASSWORD_BASE64_TESTNET: Buffer.from(password).toString('base64'),
    };
    const testnet = resolveServerConfig(serverConfigSchema.parse(env));
    expect(testnet.adsPriceUpdater).toEqual({ keystorePath: '/price-test.json', password });
    expect(testnet.adsOperator.password).toBe('operator fixture');
    const mainnet = resolveServerConfig(
      serverConfigSchema.parse({ ...env, PRECOMMUNITY_NETWORK: 'base' }),
    );
    expect(mainnet.adsPriceUpdater).toEqual({
      keystorePath: '/price-main.json',
      password: 'main price fixture',
    });
    expect(
      resolveServerConfig(
        serverConfigSchema.parse({
          ADS_PRICE_UPDATER_KEYSTORE_PATH: '/main-only.json',
          ADS_PRICE_UPDATER_KEYSTORE_PASSWORD: 'main-only fixture',
        }),
      ).adsPriceUpdater,
    ).toEqual({ keystorePath: null, password: undefined });
  });

  it.each(['invalid password encoding!', '/w=='])(
    'invalid price updater encoding disables only that signer: %s',
    (encoding) => {
      const result = resolveServerConfig(
        serverConfigSchema.parse({
          ADS_PRICE_UPDATER_KEYSTORE_PATH_TESTNET: '/price-test.json',
          ADS_PRICE_UPDATER_KEYSTORE_PASSWORD_BASE64_TESTNET: encoding,
          ADS_OPERATOR_KEYSTORE_PATH_TESTNET: '/operator-test.json',
          ADS_OPERATOR_KEYSTORE_PASSWORD_TESTNET: 'operator fixture',
          COINGECKO_API_KEY: 'collector fixture',
        }),
      );
      expect(result.adsPriceUpdater.password).toBeUndefined();
      expect(result.adsOperator.password).toBe('operator fixture');
      expect(result.COINGECKO_API_KEY).toBe('collector fixture');
    },
  );

  it('uses exact raw updater passwords before encoding and strips browser credential lookalikes', () => {
    const password = '  raw price $ ` \\ #  ';
    const parsed = serverConfigSchema.parse({
      ADS_PRICE_UPDATER_KEYSTORE_PASSWORD_TESTNET: password,
      ADS_PRICE_UPDATER_KEYSTORE_PASSWORD_BASE64_TESTNET:
        Buffer.from('older fixture').toString('base64'),
      NEXT_PUBLIC_ADS_PRICE_UPDATER_KEYSTORE_PASSWORD: 'ignored browser fixture',
    });
    expect(resolveServerConfig(parsed).adsPriceUpdater.password).toBe(password);
    expect(parsed).not.toHaveProperty('NEXT_PUBLIC_ADS_PRICE_UPDATER_KEYSTORE_PASSWORD');
  });

  it('invalid generated password encoding disables only the signer', () => {
    const result = resolveServerConfig(
      serverConfigSchema.parse({
        COINGECKO_API_KEY: 'fixture-price-key',
        ADS_OPERATOR_KEYSTORE_PATH_TESTNET: '/operator.json',
        ADS_OPERATOR_KEYSTORE_PASSWORD_BASE64_TESTNET: 'invalid password encoding!',
      }),
    );
    expect(result.adsOperator.password).toBeUndefined();
    expect(result.COINGECKO_API_KEY).toBe('fixture-price-key');
  });
  it('preserves exact keystore passwords and never uses the mainnet signer on testnet', () => {
    const password = '  secret " $ ` \\ #  ';
    const testnet = resolveServerConfig(
      serverConfigSchema.parse({
        ADS_OPERATOR_KEYSTORE_PATH: '/private/main.json',
        ADS_OPERATOR_KEYSTORE_PASSWORD: 'main-secret',
        ADS_OPERATOR_KEYSTORE_PATH_TESTNET: '/private/test.json',
        ADS_OPERATOR_KEYSTORE_PASSWORD_TESTNET: password,
      }),
    );
    expect(testnet.adsOperator).toEqual({ keystorePath: '/private/test.json', password });
    expect(
      resolveServerConfig(
        serverConfigSchema.parse({
          ADS_OPERATOR_KEYSTORE_PATH: '/private/main.json',
          ADS_OPERATOR_KEYSTORE_PASSWORD: 'main-secret',
        }),
      ).adsOperator,
    ).toEqual({ keystorePath: null, password: undefined });
    expect(
      serverConfigSchema.parse({ ADS_OPERATOR_KEYSTORE_PASSWORD: '' })
        .ADS_OPERATOR_KEYSTORE_PASSWORD,
    ).toBeUndefined();
    const encoded = Buffer.from(password).toString('base64');
    expect(
      resolveServerConfig(
        serverConfigSchema.parse({
          ADS_OPERATOR_KEYSTORE_PASSWORD_BASE64_TESTNET: encoded,
        }),
      ).adsOperator.password,
    ).toBe(password);
    expect(
      resolveServerConfig(
        serverConfigSchema.parse({
          ADS_OPERATOR_KEYSTORE_PASSWORD_TESTNET: 'raw takes precedence',
          ADS_OPERATOR_KEYSTORE_PASSWORD_BASE64_TESTNET: encoded,
        }),
      ).adsOperator.password,
    ).toBe('raw takes precedence');
  });
  it('keeps defaults and treats blank optional values as absent', () => {
    const result = resolveServerConfig(
      serverConfigSchema.parse({ SAFE_ADDRESS: ' ', BASE_RPC_URL_TESTNET: '' }),
    );
    expect(result.deployment.network).toBe('base-sepolia');
    expect(result.BASE_RPC_URL).toBe(result.deployment.defaultRpcUrl);
    expect(result.REDIS_URL).toBe('redis://127.0.0.1:6379');
    expect(result.SAFE_ADDRESS).toBeUndefined();
  });
  it('selects only active-network overrides while retaining extra API fields', () => {
    const mainnet = resolveServerConfig({
      ...serverConfigSchema.parse({
        ...deployment,
        PRECOMMUNITY_NETWORK: 'base',
        BASE_RPC_URL: 'https://main.example',
        BASE_RPC_URL_TESTNET: 'https://test.example',
        SAFE_ADDRESS: address,
        SAFE_ADDRESS_TESTNET: '0x2222222222222222222222222222222222222222',
        REDIS_URL_TESTNET: 'redis://test.example',
      }),
      PORT: 4001,
    });
    expect(mainnet).toMatchObject({
      PORT: 4001,
      BASE_RPC_URL: 'https://main.example',
      SAFE_ADDRESS: address,
      REDIS_URL: 'redis://127.0.0.1:6379',
    });
    const testnet = resolveServerConfig(
      serverConfigSchema.parse({
        BASE_RPC_URL_TESTNET: 'https://test.example',
        SAFE_ADDRESS: address,
        REDIS_URL_TESTNET: 'redis://test.example',
      }),
    );
    expect(testnet).toMatchObject({
      BASE_RPC_URL: 'https://test.example',
      SAFE_ADDRESS: undefined,
      REDIS_URL: 'redis://test.example',
    });
  });
  it('keeps the CoinGecko key server-side and treats a blank key as absent', () => {
    expect(
      serverConfigSchema.parse({ COINGECKO_API_KEY: ' \t ' }).COINGECKO_API_KEY,
    ).toBeUndefined();
    expect(
      resolveServerConfig(serverConfigSchema.parse({ COINGECKO_API_KEY: ' demo-fixture ' }))
        .COINGECKO_API_KEY,
    ).toBe('demo-fixture');
    expect(
      serverConfigSchema.parse({ NEXT_PUBLIC_COINGECKO_API_KEY: 'ignored-browser-fixture' }),
    ).not.toHaveProperty('NEXT_PUBLIC_COINGECKO_API_KEY');
  });
  it('rejects partial deployments and accepts complete production manifests', () => {
    expect(() =>
      resolveServerConfig(serverConfigSchema.parse({ ESCROW_ADDRESS_TESTNET: address })),
    ).toThrow('requires complete');
    expect(() => resolveServerConfig(serverConfigSchema.parse({ NODE_ENV: 'production' }))).toThrow(
      'requires complete',
    );
    expect(
      resolveServerConfig(
        serverConfigSchema.parse({
          ...deployment,
          NODE_ENV: 'production',
          PRECOMMUNITY_NETWORK: 'base',
        }),
      ).deployment.chainId,
    ).toBe(8453);
  });
  it.each(['', '_TESTNET'])('validates both sides of the ADS pair %s', (suffix) => {
    expect(() => serverConfigSchema.parse({ ['ADS_CONTRACT_ADDRESS' + suffix]: address })).toThrow(
      'configured together',
    );
    expect(() =>
      serverConfigSchema.parse({ ['ADS_CONTRACT_DEPLOYMENT_BLOCK' + suffix]: '0' }),
    ).toThrow('configured together');
    expect(
      serverConfigSchema.safeParse({
        ['ADS_CONTRACT_ADDRESS' + suffix]: address,
        ['ADS_CONTRACT_DEPLOYMENT_BLOCK' + suffix]: '0',
      }).success,
    ).toBe(true);
  });
});
