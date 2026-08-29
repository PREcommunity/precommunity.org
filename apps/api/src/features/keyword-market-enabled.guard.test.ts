import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { ApplicationFeaturesService } from './application-features.service';
import { KeywordMarketEnabledGuard } from './keyword-market-enabled.guard';

describe('KeywordMarketEnabledGuard', () => {
  it('returns 404 while the market is disabled', async () => {
    const features = { get: vi.fn().mockResolvedValue({ keywordMarketEnabled: false }) };
    const guard = new KeywordMarketEnabledGuard(features as unknown as ApplicationFeaturesService);

    await expect(guard.canActivate()).rejects.toBeInstanceOf(NotFoundException);
  });

  it('allows the request while the market is enabled', async () => {
    const features = { get: vi.fn().mockResolvedValue({ keywordMarketEnabled: true }) };
    const guard = new KeywordMarketEnabledGuard(features as unknown as ApplicationFeaturesService);

    await expect(guard.canActivate()).resolves.toBe(true);
  });
});
