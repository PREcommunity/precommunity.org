import { describe, expect, it } from 'vitest';
import {
  BASE_MAINNET_DEPLOYMENT,
  BASE_SEPOLIA_DEPLOYMENT,
  DEFAULT_SUBPROJECT_NAME,
  DEFAULT_SUBPROJECT_SLUG,
  canonicalGoalMetadata,
  deploymentStateKey,
  deploymentForNetwork,
  explorerTransactionUrl,
  isDeploymentConfigured,
  isValidIpfsUri,
  isValidPublicUrl,
  safeWalletQueueUrl,
} from './index';

describe('shared public validation', () => {
  it('accepts only public HTTP links', () => {
    expect(isValidPublicUrl('https://example.org')).toBe(true);
    expect(isValidPublicUrl('javascript:alert(1)')).toBe(false);
  });

  it('validates an empty URI or a CID-backed IPFS URI', () => {
    expect(isValidIpfsUri('')).toBe(true);
    expect(
      isValidIpfsUri('ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3g5lxy4t5c7hr4zy2m4ot6owe'),
    ).toBe(true);
    expect(isValidIpfsUri('ipfs://QmYwAPJzv5CZsnAzt8auVZRnGiRAK7kHbcv8wWgWjTPbro/avatar.png')).toBe(
      true,
    );
    expect(isValidIpfsUri('ipfs://baaaaaaaaaaaaaaaaaaaaa')).toBe(false);
    expect(
      isValidIpfsUri(
        'ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3g5lxy4t5c7hr4zy2m4ot6owe?filename=x',
      ),
    ).toBe(false);
    expect(isValidIpfsUri('https://gateway.example/cid')).toBe(false);
  });

  it('produces deterministic metadata and rejects unsafe document links', () => {
    const metadata = canonicalGoalMetadata({
      category: ' Infrastructure ',
      documents: [
        { label: ' Zeta ', url: 'https://example.com/z' },
        { label: 'Unsafe', url: 'javascript:alert(1)' },
        { label: 'Alpha', url: 'https://example.com/a' },
      ],
    });
    expect(metadata).toEqual({
      schema: 'precommunity.goal-metadata.v1',
      category: 'Infrastructure',
      documents: [
        { label: 'Alpha', url: 'https://example.com/a' },
        { label: 'Zeta', url: 'https://example.com/z' },
      ],
    });
  });

  it('omits the internal General subproject and empty optional fields', () => {
    expect(
      canonicalGoalMetadata({
        category: ' ',
        subproject: { name: DEFAULT_SUBPROJECT_NAME, slug: DEFAULT_SUBPROJECT_SLUG },
        discussionUrl: '',
        documents: [],
      }),
    ).toEqual({ schema: 'precommunity.goal-metadata.v1' });

    expect(
      canonicalGoalMetadata({
        category: 'Infrastructure',
        subproject: { name: 'Public nodes', slug: 'public-nodes' },
        discussionUrl: 'https://example.org/discussion',
      }),
    ).toEqual({
      schema: 'precommunity.goal-metadata.v1',
      category: 'Infrastructure',
      subproject: { name: 'Public nodes', slug: 'public-nodes' },
      discussionUrl: 'https://example.org/discussion',
    });
  });

  it('keeps Base Sepolia disabled until the new V1 escrow manifest is supplied', () => {
    expect(isDeploymentConfigured(BASE_SEPOLIA_DEPLOYMENT)).toBe(false);
    expect(BASE_SEPOLIA_DEPLOYMENT.deploymentBlock).toBe('0');
    expect(BASE_SEPOLIA_DEPLOYMENT.escrowAddress).toBe(
      '0x0000000000000000000000000000000000000000',
    );
    expect(BASE_SEPOLIA_DEPLOYMENT.preAddress).toBe('0x5471386EA2022e724A234A7690E338aA0A6689aD');
    expect(BASE_SEPOLIA_DEPLOYMENT.usdcAddress).toBe('0xdeBe6c9F496Bb7cca66727E9B8CB5B49f631058D');
    expect(deploymentStateKey()).toBe(
      'precommunity:escrow:84532:0x0000000000000000000000000000000000000000',
    );
    expect(BASE_SEPOLIA_DEPLOYMENT.confirmations).toBe(6);
    expect(BASE_SEPOLIA_DEPLOYMENT.safeNetworkPrefix).toBe('basesep');
  });

  it('requires explicit Base production deployment values', () => {
    expect(isDeploymentConfigured(BASE_MAINNET_DEPLOYMENT)).toBe(false);
    const deployment = deploymentForNetwork('base', {
      escrowAddress: '0x1111111111111111111111111111111111111111',
      deploymentBlock: '123',
      preAddress: '0x2222222222222222222222222222222222222222',
      usdcAddress: '0x3333333333333333333333333333333333333333',
      owner: '0x4444444444444444444444444444444444444444',
      treasury: '0x5555555555555555555555555555555555555555',
    });
    expect(isDeploymentConfigured(deployment)).toBe(true);
    expect(deployment.chainId).toBe(8453);
    expect(explorerTransactionUrl('0xabc', deployment)).toBe('https://basescan.org/tx/0xabc');
  });

  it('builds a Safe Wallet queue URL for each environment', () => {
    expect(
      safeWalletQueueUrl('0x1111111111111111111111111111111111111111', BASE_SEPOLIA_DEPLOYMENT),
    ).toBe(
      'https://app.safe.global/transactions/queue?safe=basesep%3A0x1111111111111111111111111111111111111111',
    );
  });
});
