import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import type { GoalDraftPreview } from '@precommunity/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getGoalPreview } from '@/lib/api';
import nextConfig from '@/next.config';
import GoalPreviewPage, { dynamic, metadata } from './page';

vi.mock('@/lib/api', () => ({ getGoalPreview: vi.fn() }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('not-found');
  },
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
}));

const draft: GoalDraftPreview = {
  title: 'Community infrastructure',
  description: 'A public request for community infrastructure.',
  status: 'DRAFT',
  category: 'Infrastructure',
  subproject: { name: 'Nodes', slug: 'nodes' },
  recipientAddress: '0x1111111111111111111111111111111111111111',
  cadence: 'ONE_TIME',
  deadline: '2028-01-31T12:00:00.000Z',
  monthlySurplusPolicy: null,
  firstSettlementAt: null,
  discussionUrl: 'https://example.com/discussion',
  metadataUri: null,
  documents: [{ label: 'Brief', url: 'https://example.com/brief' }],
  targets: [
    { asset: 'PRE', amount: '9007199254740993.000000000000000001' },
    { asset: 'USDC', amount: '10.25' },
  ],
};
const params = Promise.resolve({ token: 't'.repeat(43) });

async function render(overrides: Partial<GoalDraftPreview> = {}) {
  vi.mocked(getGoalPreview).mockResolvedValue({ kind: 'draft', draft: { ...draft, ...overrides } });
  return renderToStaticMarkup(await GoalPreviewPage({ params }));
}

beforeEach(() => vi.clearAllMocks());

describe('funding request preview page', () => {
  it('renders saved request content and exact proposed targets without funding controls', async () => {
    const html = await render();
    for (const text of [
      'Draft preview — not published',
      'Proposed funding targets',
      draft.title,
      draft.description,
      draft.recipientAddress,
      '9,007,199,254,740,993.000000000000000001 PRE',
      '10.25 USDC',
      'Deadline · UTC',
      'Supporting material',
      'https://example.com/brief',
    ])
      expect(html).toContain(text);
    for (const text of [
      '<button',
      'id="contribute"',
      'href="#contribute"',
      'Creation proof',
      'Confirmed balances',
      'Share this page',
      'Goal ID',
    ])
      expect(html).not.toContain(text);
    expect(html).toContain('rel="noreferrer"');
  });

  it('describes automatic monthly dates relative to publication and shows the surplus policy', async () => {
    const html = await render({
      cadence: 'MONTHLY',
      deadline: null,
      monthlySurplusPolicy: 'ROLL_OVER',
    });
    expect(html).toContain('Same day next month after publication, at 00:00 UTC');
    expect(html).toContain('Roll over');
    expect(html).not.toContain('Deadline · UTC');
  });

  it('shows a saved custom monthly date and pending publication without settlement actions', async () => {
    const html = await render({
      status: 'PENDING_CHAIN',
      cadence: 'MONTHLY',
      deadline: null,
      monthlySurplusPolicy: 'PAYOUT_ALL',
      firstSettlementAt: '2028-02-29T00:00:00.000Z',
    });
    expect(html).toContain('awaiting blockchain confirmation');
    expect(html).toContain('Feb 29, 2028');
    expect(html).toContain('Payout all');
    expect(html).not.toContain('Same day next month after publication');
    expect(html).not.toContain('<button');
  });

  it('escapes draft text and omits empty optional material', async () => {
    const html = await render({
      description: '<script>alert(1)</script>',
      discussionUrl: null,
      metadataUri: null,
      documents: [],
    });
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('Supporting material');
  });

  it('uses the recorded public slug for the redirect after confirmation', async () => {
    vi.mocked(getGoalPreview).mockResolvedValue({ kind: 'published', slug: 'confirmed-slug' });
    await expect(GoalPreviewPage({ params })).rejects.toThrow('redirect:/goals/confirmed-slug');
  });

  it('shows not-found for revoked or otherwise unavailable preview links', async () => {
    vi.mocked(getGoalPreview).mockResolvedValue(null);
    await expect(GoalPreviewPage({ params })).rejects.toThrow('not-found');
  });

  it('disables caching, indexing, canonical links and referrer transmission', async () => {
    expect(dynamic).toBe('force-dynamic');
    expect(metadata).toMatchObject({
      robots: { index: false, follow: false, noarchive: true },
      referrer: 'no-referrer',
      alternates: { canonical: null },
      openGraph: null,
      twitter: null,
    });
    const rules = await nextConfig.headers!();
    expect(rules).toContainEqual({
      source: '/preview/goals/:path*',
      headers: [
        { key: 'Cache-Control', value: 'private, no-store' },
        { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
        { key: 'Referrer-Policy', value: 'no-referrer' },
      ],
    });
  });

  it('preserves the no-referrer policy through the deployment proxy', () => {
    const globals = readFileSync(
      new URL('../../../../../../../ops/nginx/precommunity-http-global.conf', import.meta.url),
      'utf8',
    );
    const site = readFileSync(
      new URL('../../../../../../../ops/nginx/precommunity-http.conf', import.meta.url),
      'utf8',
    );
    expect(site).toContain('add_header Referrer-Policy $precommunity_referrer_policy always;');
    const mapping = globals.match(/map \$uri \$precommunity_referrer_policy \{([^}]+)\}/)?.[1];
    expect(mapping).toContain('default strict-origin-when-cross-origin;');
    const pattern = mapping?.match(/~(\S+) no-referrer;/)?.[1];
    expect(pattern).toBeDefined();
    const previews = new RegExp(pattern!);
    expect(previews.test('/preview/goals/secret')).toBe(true);
    expect(previews.test('/api/v1/public/goal-previews/secret')).toBe(true);
    expect(previews.test('/goals/public-request')).toBe(false);
  });
});
