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
