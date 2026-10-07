import type { AdCampaignView } from '@precommunity/shared';
import {
  Children,
  isValidElement,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
} from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useKeywordMarketRefresh } from '@/hooks/use-keyword-market-refresh';
import { AUTH_CHANGED_EVENT } from '@/lib/auth-events';
import { ApiError } from '@/lib/http';
import { getMyAdCampaigns } from '@/lib/keyword-market-api';
import { KeywordMarketCampaignList } from './keyword-market-campaign-list';

const hooks = vi.hoisted(() => ({
  states: [] as Array<{ value: unknown; update: ReturnType<typeof vi.fn> }>,
  refs: [] as Array<{ current: unknown }>,
  effects: [] as Array<() => (() => void) | undefined>,
  stateIndex: 0,
  refIndex: 0,
}));

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useCallback: (callback: unknown) => callback,
  useEffect: (callback: () => (() => void) | undefined) => hooks.effects.push(callback),
  useRef: (current: unknown) => (hooks.refs[hooks.refIndex++] ??= { current }),
  useState: (initial: unknown) => {
    const index = hooks.stateIndex++;
    const cell = (hooks.states[index] ??= {
      value: typeof initial === 'function' ? initial() : initial,
      update: vi.fn((next: unknown) => {
        cell.value = typeof next === 'function' ? next(cell.value) : next;
      }),
    });
    return [cell.value, cell.update];
  },
}));
vi.mock('next/link', () => ({
  default: ({ children, ...props }: ComponentProps<'a'>) => <a {...props}>{children}</a>,
}));
vi.mock('@/hooks/use-keyword-market-refresh', () => ({ useKeywordMarketRefresh: vi.fn() }));
vi.mock('@/lib/keyword-market-api', () => ({ getMyAdCampaigns: vi.fn() }));

type ElementProps = {
  children?: ReactNode;
  className?: string;
  'aria-label'?: string;
  disabled?: boolean;
  onClick?: () => void;
  onChange?: (event: { target: { value: string } }) => void;
};

function elements(node: ReactNode): ReactElement<ElementProps>[] {
  if (!isValidElement<ElementProps>(node)) return [];
  return [node, ...Children.toArray(node.props.children).flatMap(elements)];
}

function renderList() {
  hooks.stateIndex = 0;
  hooks.refIndex = 0;
  hooks.effects.length = 0;
  return KeywordMarketCampaignList();
}

function button(tree: ReactNode, name: string) {
  return elements(tree).find(
    (element) => element.props.children === name && element.props.onClick,
  )!;
}

function search(tree: ReactNode, value: string) {
  elements(tree).find((element) => element.props['aria-label'] === 'Search keywords')!.props
    .onChange!({ target: { value } });
}

function rows(tree: ReactNode) {
  return elements(tree).filter(
    (element) => element.props.className === 'keyword-market-ledger-row',
  );
}

function campaigns(count: number): AdCampaignView[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `campaign-${index + 1}`,
    keyword: `bitcoin ${String(index + 1).padStart(2, '0')}`,
    paused: false,
    chainStatus: 'SYNCED',
    position: null,
    leaderBidUsdRaw: null,
    bidNeededToLeadUsdRaw: null,
    activeRevision: null,
    pendingRevision: null,
    revisions: [],
    lifetimeViews: String(index + 100),
    lifetimeClicks: String(index + 10),
    createdAt: '2026-10-06T00:00:00.000Z',
    updatedAt: '2026-10-06T00:00:00.000Z',
  }));
}

function ready(data = campaigns(41)) {
  renderList();
  hooks.states[0]!.value = data;
  hooks.states[1]!.value = 'ready';
  return renderList();
}

describe('campaign search, pagination and totals', () => {
  let cleanup: (() => void) | undefined;

  beforeEach(() => {
    hooks.states.length = 0;
    hooks.refs.length = 0;
    vi.clearAllMocks();
    vi.stubGlobal('window', new EventTarget());
  });

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    vi.unstubAllGlobals();
  });

  it.each([0, 20, 21, 41])(
    'shows at most 20 of %i campaigns and valid pagination boundaries',
    (count) => {
      let tree = ready(campaigns(count));
      expect(rows(tree)).toHaveLength(Math.min(count, 20));
      if (count <= 20) {
        expect(renderToStaticMarkup(tree)).not.toContain('Campaign pagination');
        if (count === 0) expect(renderToStaticMarkup(tree)).toContain('No campaigns yet');
        return;
      }
      expect(button(tree, 'Previous').props.disabled).toBe(true);
      expect(button(tree, 'Next').props.disabled).toBe(false);
      const pageCount = Math.ceil(count / 20);
      for (let page = 1; page < pageCount; page += 1) {
        button(tree, 'Next').props.onClick!();
        tree = renderList();
      }
      expect(rows(tree)).toHaveLength(count - (pageCount - 1) * 20);
      expect(button(tree, 'Next').props.disabled).toBe(true);
      expect(button(tree, 'Previous').props.disabled).toBe(false);
      const html = renderToStaticMarkup(tree);
      expect(html).toContain(`Page ${pageCount} of ${pageCount}`);
      expect(html).toContain(`<small>${String((pageCount - 1) * 20 + 1).padStart(2, '0')}</small>`);
    },
  );

  it('filters partial keywords case-insensitively, resets the page, and separates empty results', () => {
    const data = [...campaigns(41), { ...campaigns(1)[0]!, id: 'ethereum', keyword: 'ethereum' }];
    let tree = ready(data);
    button(tree, 'Next').props.onClick!();
    tree = renderList();
    search(tree, '  BiTCoIn 0  ');
    tree = renderList();
    expect(hooks.states[4]!.value).toBe(1);
    expect(rows(tree)).toHaveLength(9);
    expect(renderToStaticMarkup(tree)).not.toContain('<strong>ethereum</strong>');
    search(tree, 'missing keyword');
    tree = renderList();
    expect(rows(tree)).toHaveLength(0);
    expect(renderToStaticMarkup(tree)).toContain('No matching campaigns');
    expect(renderToStaticMarkup(tree)).not.toContain('No campaigns yet');
    button(tree, 'Clear search').props.onClick!();
    tree = renderList();
    expect(rows(tree)).toHaveLength(20);
    expect(hooks.states[3]!.value).toBe('');
    expect(renderToStaticMarkup(tree)).toContain('42 campaigns');
  });

  it('preserves search and page during refresh and clamps the page when results shrink', async () => {
    let tree = ready();
    search(tree, 'bitcoin');
    tree = renderList();
    button(tree, 'Next').props.onClick!();
    tree = renderList();
    vi.mocked(getMyAdCampaigns).mockResolvedValueOnce(campaigns(41));
    await vi.mocked(useKeywordMarketRefresh).mock.calls.at(-1)![0](true);
    tree = renderList();
    expect(hooks.states[3]!.value).toBe('bitcoin');
    expect(hooks.states[4]!.value).toBe(2);
    expect(renderToStaticMarkup(tree)).toContain('Page 2 of 3');

    vi.mocked(getMyAdCampaigns).mockResolvedValueOnce(campaigns(5));
    await vi.mocked(useKeywordMarketRefresh).mock.calls.at(-1)![0](true);
    tree = renderList();
    expect(rows(tree)).toHaveLength(5);
    hooks.effects.at(-1)!();
    expect(hooks.states[4]!.value).toBe(1);
    expect(hooks.states[3]!.value).toBe('bitcoin');
  });

  it('shows PRE with full precision and lifetime campaign view/click totals', () => {
    const data = campaigns(4);
    const stakes = ['1000000000000000000', '2500000000000000000', '1'];
    for (const [index, stakeRaw] of stakes.entries()) {
      data[index]!.position = {
        rank: index + 1,
        stakerAddress: `0x${'11'.repeat(20)}`,
        stakeRaw,
        bidUsdRaw: '100000',
        requiredCoveragePreRaw: '0',
        eligible: index !== 1,
        withdrawAvailableAt: '0',
        positionVersion: '1',
        amountSinceBlock: '1',
        amountSinceLogIndex: 1,
        positionBlock: '1',
        positionTxHash: `0x${'22'.repeat(32)}`,
        hasEligibleAd: true,
      };
    }
    data[0]!.lifetimeViews = '9007199254740993000';
    data[0]!.lifetimeClicks = '1234';
    const html = renderToStaticMarkup(ready(data));
    expect(html).toContain('1 PRE');
    expect(html).toContain('2.5 PRE');
    expect(html).toContain('0.000000000000000001 PRE');
    expect(html).toContain('0 PRE');
    expect(html).toContain('9,007,199,254,740,993,000');
    expect(html).toContain('1,234');
    expect(html).toContain('>Views</span>');
    expect(html).toContain('>Clicks</span>');
    expect(html).not.toContain('30 day resolves');
    expect(html).not.toContain('raw PRE');
  });

  it.each(['success', '401'] as const)(
    'discards an old session %s and resets search/page before loading the new account',
    async (outcome) => {
      let finishOldRequest!: (value: AdCampaignView[]) => void;
      let rejectOldRequest!: (reason: Error) => void;
      const nextAccount = [{ ...campaigns(1)[0]!, id: 'new-account', keyword: 'new account' }];
      vi.mocked(getMyAdCampaigns)
        .mockImplementationOnce(
          () =>
            new Promise((resolve, reject) => {
              finishOldRequest = resolve;
              rejectOldRequest = reject;
            }),
        )
        .mockResolvedValueOnce(nextAccount);
      renderList();
      cleanup = hooks.effects[0]!();
      hooks.states[0]!.value = campaigns(41);
      hooks.states[3]!.value = 'bitcoin';
      hooks.states[4]!.value = 2;
      window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
      expect(hooks.states[0]!.value).toEqual([]);
      expect(hooks.states[3]!.value).toBe('');
      expect(hooks.states[4]!.value).toBe(1);
      expect(getMyAdCampaigns).toHaveBeenCalledOnce();
      if (outcome === 'success') finishOldRequest(campaigns(41));
      else rejectOldRequest(new ApiError('Old session expired', 401));
      await vi.waitFor(() => {
        expect(getMyAdCampaigns).toHaveBeenCalledTimes(2);
        expect(hooks.states[0]!.value).toEqual(nextAccount);
        expect(hooks.states[1]!.value).toBe('ready');
      });
      expect(hooks.states[1]!.update).not.toHaveBeenCalledWith('signed-out');
      expect(hooks.states[0]!.update).not.toHaveBeenCalledWith(campaigns(41));
    },
  );
});
