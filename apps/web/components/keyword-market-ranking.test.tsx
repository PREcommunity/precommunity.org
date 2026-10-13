import type { AdKeywordResponse } from '@precommunity/shared';
import {
  Children,
  isValidElement,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
} from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KeywordMarketRanking } from './keyword-market-ranking';

const hooks = vi.hoisted(() => ({
  states: [] as unknown[],
  effects: [] as Array<() => void>,
  stateIndex: 0,
  sessionAddress: undefined as string | undefined,
}));

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useState: (initial: unknown) => {
    const index = hooks.stateIndex++;
    if (!(index in hooks.states))
      hooks.states[index] = typeof initial === 'function' ? initial() : initial;
    return [
      hooks.states[index],
      (next: unknown) => {
        hooks.states[index] = typeof next === 'function' ? next(hooks.states[index]) : next;
      },
    ];
  },
  useEffect: (callback: () => void) => hooks.effects.push(callback),
}));
vi.mock('next/link', () => ({
  default: ({ children, ...props }: ComponentProps<'a'>) => <a {...props}>{children}</a>,
}));
vi.mock('@/hooks/use-wallet-session', () => ({
  useWalletSession: () => ({ sessionAddress: hooks.sessionAddress }),
}));

type ElementProps = {
  children?: ReactNode;
  className?: string;
  disabled?: boolean;
  onClick?: () => void;
};

function elements(node: ReactNode): ReactElement<ElementProps>[] {
  if (!isValidElement<ElementProps>(node)) return [];
  return [node, ...Children.toArray(node.props.children).flatMap(elements)];
}

function rows(tree: ReactNode) {
  return elements(tree).filter(
    (element) => element.props.className === 'keyword-market-ledger-row',
  );
}

function button(tree: ReactNode, name: string) {
  return elements(tree).find(
    (element) => element.props.children === name && element.props.onClick,
  )!;
}

function ranking(count: number): AdKeywordResponse {
  return {
    keyword: 'bitcoin',
    chainStatus: 'SYNCED',
    chainId: 8453,
    contractAddress: `0x${'99'.repeat(20)}`,
    indexedThroughBlock: '120',
    positions: Array.from({ length: count }, (_, index) => ({
      rank: index + 1,
      stakerAddress: `0x${(index + 1).toString(16).padStart(40, '0')}`,
      stakeRaw: '1000000000000000000',
      bidUsdRaw: '100000',
      requiredCoveragePreRaw: '1000000000000000000',
      eligible: true,
      withdrawAvailableAt: '0',
      positionVersion: '1',
      amountSinceBlock: '100',
      amountSinceLogIndex: index,
      positionBlock: '100',
      positionTxHash: `0x${'11'.repeat(32)}`,
      hasEligibleAd: true,
    })),
  };
}

function renderRanking(data: AdKeywordResponse, editHref?: string) {
  hooks.stateIndex = 0;
  hooks.effects.length = 0;
  return KeywordMarketRanking({ data, editHref });
}

describe('keyword ranking pagination', () => {
  beforeEach(() => {
    hooks.states.length = 0;
    hooks.effects.length = 0;
    hooks.sessionAddress = undefined;
  });

  it.each([0, 20, 21, 41])(
    'shows at most 20 of %i positions with valid page boundaries',
    (count) => {
      const data = ranking(count);
      let tree = renderRanking(data);
      expect(rows(tree)).toHaveLength(Math.min(count, 20));
      if (count <= 20) {
        expect(renderToStaticMarkup(tree)).not.toContain('Ranking pagination');
        return;
      }

      expect(button(tree, 'Previous').props.disabled).toBe(true);
      expect(button(tree, 'Next').props.disabled).toBe(false);
      const pageCount = Math.ceil(count / 20);
      for (let page = 1; page < pageCount; page += 1) {
        button(tree, 'Next').props.onClick!();
        tree = renderRanking(data);
      }
      expect(rows(tree)).toHaveLength(count - (pageCount - 1) * 20);
      expect(button(tree, 'Previous').props.disabled).toBe(false);
      expect(button(tree, 'Next').props.disabled).toBe(true);
      expect(renderToStaticMarkup(tree)).toContain(`Page ${pageCount} of ${pageCount}`);

      button(tree, 'Previous').props.onClick!();
      tree = renderRanking(data);
      expect(rows(tree)).toHaveLength(20);
      expect(renderToStaticMarkup(tree)).toContain(`Page ${pageCount - 1} of ${pageCount}`);
    },
  );

  it('preserves absolute backend ranks and keeps the owned Edit action on its later page', () => {
    const data = ranking(21);
    const owned = data.positions[20]!;
    owned.rank = 87;
    hooks.sessionAddress = owned.stakerAddress.toUpperCase();
    const editHref = '/keyword-market/campaigns/owned-campaign';
    let tree = renderRanking(data, editHref);
    expect(renderToStaticMarkup(tree)).not.toContain(editHref);
    const competitorCells = Children.toArray(rows(tree)[0]!.props.children);
    expect(competitorCells).toHaveLength(6);
    expect(renderToStaticMarkup(competitorCells[5])).not.toContain('Edit');

    button(tree, 'Next').props.onClick!();
    tree = renderRanking(data, editHref);
    expect(rows(tree)).toHaveLength(1);
    const ownedCells = Children.toArray(rows(tree)[0]!.props.children);
    expect(ownedCells).toHaveLength(6);
    expect(renderToStaticMarkup(ownedCells[0])).not.toContain('Edit');
    expect(renderToStaticMarkup(ownedCells[5])).toContain(`href="${editHref}"`);
    expect(renderToStaticMarkup(ownedCells[5])).toContain('Edit</a>');
    const html = renderToStaticMarkup(tree);
    expect(html).toContain('>#87</small>');
    expect(html).toContain('(you)');
    expect(html).toContain(`href="${editHref}"`);
    expect(html).toContain('Edit</a>');
  });

  it('clamps the page when refreshed positions shrink and keeps that page after they grow', () => {
    const data = ranking(41);
    let tree = renderRanking(data);
    button(tree, 'Next').props.onClick!();
    tree = renderRanking(data);
    button(tree, 'Next').props.onClick!();
    tree = renderRanking(data);
    expect(renderToStaticMarkup(tree)).toContain('Page 3 of 3');

    tree = renderRanking(ranking(21));
    expect(rows(tree)).toHaveLength(1);
    expect(renderToStaticMarkup(tree)).toContain('Page 2 of 2');
    for (const effect of hooks.effects) effect();

    tree = renderRanking(data);
    expect(rows(tree)).toHaveLength(20);
    expect(renderToStaticMarkup(tree)).toContain('Page 2 of 3');

    tree = renderRanking(ranking(5));
    expect(rows(tree)).toHaveLength(5);
    expect(renderToStaticMarkup(tree)).not.toContain('Ranking pagination');
    for (const effect of hooks.effects) effect();
    tree = renderRanking(data);
    expect(renderToStaticMarkup(tree)).toContain('Page 1 of 3');
  });

  it('limits PRE stake display to four decimals while retaining its raw amount', () => {
    const data = ranking(1);
    data.positions[0]!.stakeRaw = '981903430762631203492';
    const html = renderToStaticMarkup(renderRanking(data));
    expect(html).toContain('<strong>981.9034</strong>');
    expect(html).not.toContain('981.903430762631203492');
    expect(data.positions[0]!.stakeRaw).toBe('981903430762631203492');
  });
});
