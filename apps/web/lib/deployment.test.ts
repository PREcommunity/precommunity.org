import { describe, expect, it } from 'vitest';
import { deploymentForNetwork } from '@precommunity/shared';
import { explorerAddressUrl, publicDeploymentNetwork } from './deployment';

describe('public deployment network', () => {
  it('accepts only supported network names', () => {
    expect(publicDeploymentNetwork('base', 'production')).toBe('base');
    expect(publicDeploymentNetwork(' base-sepolia ', 'production')).toBe('base-sepolia');
    expect(() => publicDeploymentNetwork('base-sepolai', 'production')).toThrow(
      'Unsupported NEXT_PUBLIC_PRECOMMUNITY_NETWORK',
    );
  });

  it('defaults locally but requires an explicit production network', () => {
    expect(publicDeploymentNetwork(undefined, 'test')).toBe('base-sepolia');
    expect(publicDeploymentNetwork(' ', 'development')).toBe('base-sepolia');
    expect(() => publicDeploymentNetwork(undefined, 'production')).toThrow(
      'NEXT_PUBLIC_PRECOMMUNITY_NETWORK is required in production',
    );
  });

  it('builds address links for Base Sepolia and Base explorers', () => {
    const address = '0x1111111111111111111111111111111111111111';
    expect(explorerAddressUrl(address, deploymentForNetwork('base-sepolia'))).toBe(
      'https://sepolia.basescan.org/address/0x1111111111111111111111111111111111111111',
    );
    expect(explorerAddressUrl(address, deploymentForNetwork('base'))).toBe(
      'https://basescan.org/address/0x1111111111111111111111111111111111111111',
    );
  });
});
