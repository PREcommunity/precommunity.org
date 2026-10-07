import type { AdAdminRevisionView } from '@precommunity/shared';
import { Children, isValidElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getAdAdminAudit,
  getAdAdminReports,
  getAdAdminRevisions,
  moderateAdRevision,
} from '@/lib/keyword-market-api';
import { KeywordMarketAdminPanel } from './keyword-market-admin-panel';

const hooks = vi.hoisted(() => ({
  revisions: [] as AdAdminRevisionView[],
  index: 0,
}));

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useCallback: (callback: unknown) => callback,
  useEffect: vi.fn(),
  useState: (initial: unknown) => {
    const index = hooks.index++;
    return [index === 0 ? hooks.revisions : initial === 'loading' ? 'ready' : initial, vi.fn()];
  },
}));
vi.mock('@/lib/keyword-market-api', () => ({
  getAdAdminAudit: vi.fn(),
  getAdAdminReports: vi.fn(),
  getAdAdminRevisions: vi.fn(),
  moderateAdRevision: vi.fn(),
  resolveAdReports: vi.fn(),
}));

const revision: AdAdminRevisionView = {
  id: 'published-older-revision',
  version: 1,
  headline: 'Original destination',
  description: 'The original ad may still receive clicks through its permanent link.',
  destinationUrl: 'https://example.com/old',
  displayDomain: 'example.com',
  status: 'SUPERSEDED',
  canSuspend: true,
  moderationNote: null,
  createdAt: '2026-10-07T12:00:00.000Z',
  lifetimeResolutions: '0',
  last30DaysResolutions: '0',
  keyword: 'tesla',
  advertiserAddress: '0x1111111111111111111111111111111111111111',
  reportCount: '0',
  proof: null,
};

function suspendAction(node: ReactNode): (() => void) | undefined {
  if (!isValidElement<{ children?: ReactNode; onClick?: () => void }>(node)) return;
  if (node.props.children === 'Suspend') return node.props.onClick;
  for (const child of Children.toArray(node.props.children)) {
    const action = suspendAction(child);
    if (action) return action;
  }
}

describe('moderator suspension of older published creatives', () => {
  beforeEach(() => {
    hooks.index = 0;
    hooks.revisions = [];
    vi.clearAllMocks();
    vi.mocked(getAdAdminRevisions).mockResolvedValue([]);
    vi.mocked(getAdAdminReports).mockResolvedValue({ items: [], nextCursor: null });
    vi.mocked(getAdAdminAudit).mockResolvedValue([]);
    vi.mocked(moderateAdRevision).mockResolvedValue(undefined);
  });

  it.each([
    ['APPROVED', true],
    ['SUPERSEDED', true],
    ['SUPERSEDED', false],
    ['PENDING_REVIEW', false],
    ['SUSPENDED', false],
  ] as const)('shows Suspend for %s only when the API allows it: %s', (status, canSuspend) => {
    hooks.revisions = [{ ...revision, status, canSuspend }];
    const tree = KeywordMarketAdminPanel();
    expect(renderToStaticMarkup(tree).includes('>Suspend</button>')).toBe(canSuspend);
    expect(Boolean(suspendAction(tree))).toBe(canSuspend);
  });

  it('submits suspension for the exact previously published superseded revision', async () => {
    hooks.revisions = [revision];
    suspendAction(KeywordMarketAdminPanel())!();
    await vi.waitFor(() => {
      expect(moderateAdRevision).toHaveBeenCalledWith(revision.id, 'SUSPEND', undefined);
      expect(getAdAdminRevisions).toHaveBeenCalledOnce();
    });
  });
});
