import type { AdAdminKeywordPage } from '@precommunity/shared';
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTH_CHANGED_EVENT } from '@/lib/auth-events';
import { ApiError } from '@/lib/http';
import { KeywordMarketKeywordsPanel } from './keyword-market-keywords-panel';

const hooks = vi.hoisted(() => ({
  states: [] as Array<{ value: unknown; update: (next: unknown) => void }>,
  refs: [] as Array<{ current: unknown }>,
  effects: [] as Array<{
    callback: () => (() => void) | undefined;
    dependencies: unknown[];
    cleanup?: () => void;
    pending: boolean;
  }>,
  stateIndex: 0,
  refIndex: 0,
  effectIndex: 0,
}));
const api = vi.hoisted(() => vi.fn());
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useState: (initial: unknown) => {
    const cell = (hooks.states[hooks.stateIndex++] ??= {
      value: initial,
      update: (next: unknown) => {
        cell.value = typeof next === 'function' ? next(cell.value) : next;
      },
    });
    return [cell.value, cell.update];
  },
  useRef: (current: unknown) => (hooks.refs[hooks.refIndex++] ??= { current }),
  useEffect: (callback: () => (() => void) | undefined, dependencies: unknown[]) => {
    const index = hooks.effectIndex++;
    const previous = hooks.effects[index];
    if (
      !previous ||
      dependencies.some((dependency, i) => !Object.is(dependency, previous.dependencies[i]))
    ) {
      hooks.effects[index] = { callback, dependencies, cleanup: previous?.cleanup, pending: true };
    }
  },
}));
vi.mock('@/lib/http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/http')>()),
  clientApiJson: api,
}));

const endpoint = '/v1/admin/keyword-market/keywords';
function pageResponse(page = 1, total = 21): AdAdminKeywordPage {
  return {
    chainId: 8453,
    contractAddress: `0x${'11'.repeat(20)}`,
    chainStatus: 'SYNCED',
    page,
    pageSize: 20,
    total,
    items:
      total === 0
        ? []
        : [{ keyword: page === 1 ? 'ethereum gas' : 'bitcoin', stakeRaw: '981903430762631203492' }],
  };
}

type Props = {
  children?: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  onChange?: (event: { target: { value: string } }) => void;
  'aria-label'?: string;
};
function elements(node: ReactNode): ReactElement<Props>[] {
  if (!isValidElement<Props>(node)) return [];
  return [node, ...Children.toArray(node.props.children).flatMap(elements)];
}
function button(tree: ReactNode, name: string) {
  return elements(tree).find(
    (element) => element.props.children === name && element.props.onClick,
  )!;
}
function render() {
  hooks.stateIndex = hooks.refIndex = hooks.effectIndex = 0;
  return KeywordMarketKeywordsPanel();
}
function commit() {
  const tree = render();
  for (const effect of hooks.effects)
    if (effect.pending) {
      effect.cleanup?.();
      effect.pending = false;
      effect.cleanup = effect.callback();
    }
  return tree;
}
async function settle() {
  for (let i = 0; i < 3; i++) {
    await Promise.resolve();
    commit();
  }
  return render();
}
function search(value: string) {
  elements(render()).find((element) => element.props['aria-label'] === 'Search keywords')!.props
    .onChange!({ target: { value } });
  commit();
}
function cleanup() {
  for (const effect of hooks.effects) effect.cleanup?.();
}

describe('admin Keyword list', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    hooks.states.length = hooks.refs.length = hooks.effects.length = 0;
    api.mockReset();
    api.mockImplementation(async (path: string) =>
      pageResponse(Number(new URL(path, 'https://example.com').searchParams.get('page'))),
    );
    vi.stubGlobal('window', new EventTarget());
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('loads one server page without polling and formats PRE without changing the raw amount', async () => {
    commit();
    const html = renderToStaticMarkup(await settle());
    expect(api).toHaveBeenCalledWith(
      `${endpoint}?q=&page=1`,
      { cache: 'no-store', signal: expect.any(AbortSignal) },
      'Keyword list',
    );
    expect(html).toContain('981.9034');
    expect(html).not.toContain('981.903430762631203492');
    expect(html).toContain('href="/keyword-market/keywords/ethereum%20gas"');
    expect(html).toContain('Page 1 of 2');
    expect(html).toContain('maxLength="64"');
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(api).toHaveBeenCalledOnce();
  });

  it('requests server pages and resets to page one after a debounced partial search', async () => {
    commit();
    let tree = await settle();
    expect(button(tree, 'Previous').props.disabled).toBe(true);
    button(tree, 'Next').props.onClick!();
    commit();
    tree = await settle();
    expect(api).toHaveBeenLastCalledWith(
      `${endpoint}?q=&page=2`,
      expect.anything(),
      'Keyword list',
    );
    expect(button(tree, 'Next').props.disabled).toBe(true);
    search('ether');
    await vi.advanceTimersByTimeAsync(200);
    search(' ethereum gas ');
    await vi.advanceTimersByTimeAsync(299);
    expect(api).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    tree = await settle();
    expect(api).toHaveBeenLastCalledWith(
      `${endpoint}?q=ethereum+gas&page=1`,
      expect.anything(),
      'Keyword list',
    );
    expect(renderToStaticMarkup(tree)).toContain('Page 1 of 2');
  });

  it('aborts a pending old search and rejects a delayed response that ignores cancellation', async () => {
    let finish!: (page: AdAdminKeywordPage) => void;
    api.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    commit();
    const signal = api.mock.calls[0]![1].signal as AbortSignal;
    search('new');
    expect(signal.aborted).toBe(true);
    finish({ ...pageResponse(), items: [{ keyword: 'obsolete result', stakeRaw: '1' }] });
    await settle();
    expect(renderToStaticMarkup(render())).not.toContain('obsolete result');
    await vi.advanceTimersByTimeAsync(300);
    await settle();
    expect(api).toHaveBeenCalledTimes(2);
  });

  it('keeps an equivalent whitespace edit from aborting the current request', async () => {
    let finish!: (page: AdAdminKeywordPage) => void;
    api.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    commit();
    search('   ');
    expect((api.mock.calls[0]![1].signal as AbortSignal).aborted).toBe(false);
    finish(pageResponse());
    await settle();
    expect(renderToStaticMarkup(render())).toContain('ethereum gas');
    expect(api).toHaveBeenCalledOnce();
  });

  it.each([401, 403])(
    'clears keyword data after auth loss and handles expired access %s',
    async (status) => {
      commit();
      await settle();
      api.mockRejectedValueOnce(new ApiError('Access denied', status));
      window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
      const html = renderToStaticMarkup(await settle());
      expect(html).not.toContain('ethereum gas');
      expect(html).toContain('Sign in with an admin wallet');
      expect(button(render(), 'Refresh keywords').props.disabled).toBe(true);
    },
  );

  it('aborts pending requests on unmount and ignores their later response', async () => {
    let finish!: (page: AdAdminKeywordPage) => void;
    api.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    commit();
    const signal = api.mock.calls[0]![1].signal as AbortSignal;
    cleanup();
    expect(signal.aborted).toBe(true);
    finish(pageResponse());
    await Promise.resolve();
    expect(hooks.states[4]!.value).toBeNull();
  });

  it('distinguishes an empty market, empty search and a request failure with manual retry', async () => {
    api.mockResolvedValueOnce(pageResponse(1, 0));
    commit();
    expect(renderToStaticMarkup(await settle())).toContain('No keywords yet.');
    search('missing');
    api.mockResolvedValueOnce(pageResponse(1, 0));
    await vi.advanceTimersByTimeAsync(300);
    expect(renderToStaticMarkup(await settle())).toContain('No keywords match your search.');
    api.mockRejectedValueOnce(new Error('Keyword service unavailable'));
    button(render(), 'Refresh keywords').props.onClick!();
    commit();
    const html = renderToStaticMarkup(await settle());
    expect(html).toContain('Keyword service unavailable');
    expect(html).not.toContain('No keywords match');
    button(render(), 'Refresh keywords').props.onClick!();
    commit();
    expect(renderToStaticMarkup(await settle())).toContain('ethereum gas');
  });

  it.each(['SYNCING', 'AWAITING_CONTRACT'] as const)(
    'describes chain state %s without inventing an available stake',
    async (chainStatus) => {
      api.mockResolvedValueOnce({ ...pageResponse(), chainStatus });
      commit();
      const html = renderToStaticMarkup(await settle());
      if (chainStatus === 'SYNCING') {
        expect(html).toContain('Updating market data. Showing the latest indexed stakes.');
        expect(html).toContain('981.9034 PRE');
      } else {
        expect(html).toContain('Stake amounts are unavailable.');
        expect(html).not.toContain('981.9034 PRE');
      }
    },
  );
});
