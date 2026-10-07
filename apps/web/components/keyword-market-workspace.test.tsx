import { isValidElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdKeywordResponse } from '@precommunity/shared';
import { AUTH_CHANGED_EVENT } from '@/lib/auth-events';
import { getAdKeyword, getKeywordMarketStatus, getMyAdCampaigns } from '@/lib/keyword-market-api';
import { KeywordMarketWorkspace } from './keyword-market-workspace';
import { KeywordMarketCampaignForm } from './keyword-market-campaign-form';
import { KeywordMarketRanking } from './keyword-market-ranking';

const hooks = vi.hoisted(() => ({
  states: [] as unknown[],
  refs: [] as Array<{ current: unknown }>,
  effects: [] as Array<{ deps: readonly unknown[]; cleanup?: () => void }>,
  callbacks: [] as Array<{ deps: readonly unknown[]; value: unknown }>,
  pending: [] as Array<() => void>,
  stateIndex: 0,
  refIndex: 0,
  effectIndex: 0,
  callbackIndex: 0,
  session: { sessionAddress: undefined as string | undefined, sessionReady: true },
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
  useRef: (current: unknown) => (hooks.refs[hooks.refIndex++] ??= { current }),
  useMemo: (calculate: () => unknown) => calculate(),
  useCallback: (callback: unknown, deps: readonly unknown[]) => {
    const index = hooks.callbackIndex++;
    const previous = hooks.callbacks[index];
    if (previous && deps.every((value, i) => Object.is(value, previous.deps[i])))
      return previous.value;
    hooks.callbacks[index] = { deps, value: callback };
    return callback;
  },
  useEffect: (callback: () => (() => void) | undefined, deps: readonly unknown[]) => {
    const index = hooks.effectIndex++;
    const previous = hooks.effects[index];
    if (previous && deps.every((value, i) => Object.is(value, previous.deps[i]))) return;
    hooks.pending.push(() => {
      previous?.cleanup?.();
      hooks.effects[index] = { deps, cleanup: callback() ?? undefined };
    });
  },
}));
vi.mock('next/link', () => ({
  default: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a>,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('@/hooks/use-wallet-session', () => ({ useWalletSession: () => hooks.session }));
vi.mock('@/lib/keyword-market-api', () => ({
  getAdKeyword: vi.fn(),
  getKeywordMarketStatus: vi.fn(),
  getMyAdCampaigns: vi.fn(),
  createAdCampaign: vi.fn(),
}));
vi.mock('./form-validation', () => ({
  useFormValidation: () => ({
    fieldProps: () => ({}),
    errorProps: () => ({}),
    onInput: vi.fn(),
    onInvalid: vi.fn(),
  }),
  FormFieldError: () => null,
}));

const ranking: AdKeywordResponse = {
  keyword: 'tesla',
  chainStatus: 'SYNCED',
  chainId: 84532,
  contractAddress: '0xmarket',
  indexedThroughBlock: '120',
  positions: [],
};

function render(query = 'tesla') {
  hooks.stateIndex = hooks.refIndex = hooks.effectIndex = hooks.callbackIndex = 0;
  const tree = KeywordMarketWorkspace({ initialQuery: query });
  return { tree, html: renderToStaticMarkup(tree) };
}

async function settle() {
  for (const effect of hooks.pending.splice(0)) effect();
  await Promise.resolve();
  await Promise.resolve();
}

function host(node: ReactNode, type: string): Record<string, any> | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const result = host(child, type);
      if (result) return result;
    }
  } else if (isValidElement<Record<string, any>>(node)) {
    if (node.type === type) return node.props;
    return host(node.props.children, type);
  }
}

describe('keyword Search and campaign actions', () => {
  beforeEach(() => {
    hooks.states = [];
    hooks.refs = [];
    hooks.effects = [];
    hooks.callbacks = [];
    hooks.pending = [];
    hooks.session = { sessionAddress: undefined, sessionReady: true };
    vi.clearAllMocks();
    vi.stubGlobal('window', new EventTarget());
    vi.mocked(getKeywordMarketStatus).mockResolvedValue({
      status: 'SYNCED',
      chainId: 84532,
      contractAddress: '0xmarket',
      deploymentBlock: '1',
      indexedThroughBlock: '120',
      transactionsEnabled: true,
      minimumStakeRaw: '1',
      preTokenAddress: '0xtoken',
    });
    vi.mocked(getAdKeyword).mockResolvedValue(ranking);
    vi.mocked(getMyAdCampaigns).mockResolvedValue([]);
  });
  afterEach(() => {
    for (const effect of hooks.effects) effect?.cleanup?.();
    vi.unstubAllGlobals();
  });

  it('offers a normalized new stake before Search and uses the full phrase for ranking', async () => {
    const query = '  TESLA—Motors xyz  ';
    const first = render(query);
    expect(first.html).toContain(
      'href="/keyword-market/campaigns/new?keyword=tesla%20motors%20xyz"',
    );
    expect(first.html).toContain('aria-label="New stake for tesla motors xyz"');
    expect(getAdKeyword).not.toHaveBeenCalled();
    await settle();
    expect(getAdKeyword).toHaveBeenCalledWith('tesla motors xyz');
    expect(getMyAdCampaigns).not.toHaveBeenCalled();
  });

  it('edits an owned paused campaign without an active position or eligible ad', async () => {
    hooks.session.sessionAddress = '0xowner';
    vi.mocked(getMyAdCampaigns).mockResolvedValue([
      { id: 'campaign-1', keyword: 'tesla', paused: true, position: null } as Awaited<
        ReturnType<typeof getMyAdCampaigns>
      >[number],
    ]);
    expect(render().html).toContain('Checking ownership');
    await settle();
    expect(render().html).toContain('href="/keyword-market/campaigns/campaign-1"');
    expect(render().html).toContain('aria-label="Edit for tesla"');
  });

  it('changes the action immediately and discards the pending old keyword response', async () => {
    let finish!: (value: AdKeywordResponse) => void;
    vi.mocked(getAdKeyword).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render();
    await settle();
    const current = render();
    host(current.tree, 'input')!.onChange({ target: { value: 'other phrase' } });
    finish({
      ...ranking,
      positions: [{ stakerAddress: '0xobsolete' }] as AdKeywordResponse['positions'],
    });
    await settle();
    const next = render();
    expect(next.html).toContain('/campaigns/new?keyword=other%20phrase');
    expect(next.html).not.toContain('0xobsolete');
    host(next.tree, 'form')!.onSubmit({ preventDefault: vi.fn() });
    await settle();
    expect(getAdKeyword).toHaveBeenLastCalledWith('other phrase');
  });

  it.each(['pending', 'ready'])(
    'resets an %s initial search when the query URL becomes empty',
    async (stage) => {
      let finish!: (value: AdKeywordResponse) => void;
      if (stage === 'pending')
        vi.mocked(getAdKeyword).mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              finish = resolve;
            }),
        );
      render();
      await settle();
      render('');
      await settle();
      if (finish) {
        finish(ranking);
        await settle();
      }
      const next = render('');
      expect(next.html).toContain('Search a keyword to inspect');
      expect(next.html).not.toContain('Searching…');
      expect(next.html).not.toContain('No confirmed positions');
      expect(next.html).not.toContain('href="/keyword-market/campaigns/new');
    },
  );

  it('does not turn an ownership error into a new-campaign link', async () => {
    hooks.session.sessionAddress = '0xowner';
    vi.mocked(getMyAdCampaigns).mockRejectedValue(new Error('Campaign lookup failed'));
    render();
    await settle();
    const next = render();
    expect(next.html).toContain('Campaign lookup failed');
    expect(next.html).toContain('Check campaigns again');
    expect(next.html).not.toContain('href="/keyword-market/campaigns/new');
  });

  it('drops owned data on logout and ignores the delayed previous-session response', async () => {
    let finish!: (value: Awaited<ReturnType<typeof getMyAdCampaigns>>) => void;
    hooks.session.sessionAddress = '0xowner';
    vi.mocked(getMyAdCampaigns).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render();
    await settle();
    hooks.session.sessionAddress = undefined;
    window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
    render();
    await settle();
    finish([
      { id: 'old-private-campaign', keyword: 'tesla' } as Awaited<
        ReturnType<typeof getMyAdCampaigns>
      >[number],
    ]);
    await settle();
    expect(render().html).not.toContain('old-private-campaign');
    expect(render().html).toContain('href="/keyword-market/campaigns/new?keyword=tesla"');
  });

  it.each(['!!!', 'one two three four five six', 'x'.repeat(65)])(
    'disables stake for an invalid phrase',
    (query) => {
      const html = render(query).html;
      expect(html).toContain('aria-invalid="true"');
      expect(html).not.toContain('href="/keyword-market/campaigns/new');
    },
  );

  it('initializes the campaign form with the editable passed keyword', () => {
    hooks.stateIndex = hooks.refIndex = hooks.effectIndex = hooks.callbackIndex = 0;
    const html = renderToStaticMarkup(
      KeywordMarketCampaignForm({ initialKeyword: 'tesla motors' }),
    );
    expect(html).toContain('value="tesla motors"');
    expect(html).not.toContain('readOnly');
  });

  it.each([
    ['0', '0'],
    ['1000000000000000000', '1'],
    ['2500000000000000000', '2.5'],
    ['1', '0.000000000000000001'],
    ['100000000000000001', '0.100000000000000001'],
  ])('renders stake %s in exact PRE units', (raw, expected) => {
    const html = renderToStaticMarkup(
      <KeywordMarketRanking
        data={{
          ...ranking,
          positions: [
            {
              rank: 1,
              stakerAddress: '0xowner',
              stakeRaw: raw,
              bidUsdRaw: '100000',
              eligible: true,
              withdrawAvailableAt: '0',
              positionBlock: '100',
              positionTxHash: '0xhash',
              hasEligibleAd: true,
            } as AdKeywordResponse['positions'][number],
          ],
        }}
      />,
    );
    expect(html).toContain(`<strong>${expected}</strong><small>PRE</small>`);
    expect(html).not.toContain('raw PRE');
  });
});
