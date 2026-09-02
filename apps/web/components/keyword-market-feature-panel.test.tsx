import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KeywordMarketFeaturePanel } from './keyword-market-feature-panel';

const featureState = vi.hoisted(() => ({ enabled: true }));

vi.mock('@/hooks/use-application-features', () => ({
  useApplicationFeatures: () => ({
    features: { keywordMarketEnabled: featureState.enabled },
    loading: false,
    refresh: vi.fn(),
  }),
}));

describe('KeywordMarketFeaturePanel moderation link', () => {
  beforeEach(() => {
    featureState.enabled = true;
  });

  it('links moderators to the existing ad moderation workspace when the market is enabled', () => {
    const html = renderToStaticMarkup(<KeywordMarketFeaturePanel canManage canModerate />);
    expect(html).toContain('href="/keyword-market/admin"');
  });

  it('does not link to a disabled market', () => {
    featureState.enabled = false;
    const html = renderToStaticMarkup(<KeywordMarketFeaturePanel canManage canModerate />);
    expect(html).not.toContain('href="/keyword-market/admin"');
  });

  it('does not expose moderation to an unauthorized role', () => {
    const html = renderToStaticMarkup(
      <KeywordMarketFeaturePanel canManage={false} canModerate={false} />,
    );
    expect(html).not.toContain('href="/keyword-market/admin"');
  });
});
