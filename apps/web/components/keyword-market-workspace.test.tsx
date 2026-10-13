import { isValidElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdKeywordResponse } from '@precommunity/shared';
import { AUTH_CHANGED_EVENT } from '@/lib/auth-events';
import { getAdKeyword, getKeywordMarketStatus, getMyAdCampaigns } from '@/lib/keyword-market-api';
import { ActionButton } from './action-button';
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

const rankingPosition: AdKeywordResponse['positions'][number] = {
  rank: 1,
  stakerAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
  stakeRaw: '1000000000000000000',
  bidUsdRaw: '100000',
  requiredCoveragePreRaw: '1000000000000000000',
  eligible: true,
  withdrawAvailableAt: '0',
  positionVersion: '1',
  amountSinceBlock: '100',
  amountSinceLogIndex: 0,
  positionBlock: '100',
  positionTxHash: `0x${'1'.repeat(64)}`,
  hasEligibleAd: true,
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

function host(
  node: ReactNode,
  type: string | typeof ActionButton,
): Record<string, any> | undefined {
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

  it.each([false, true])(
    'accepts input only after hydration with session ready %s',
    async (ready) => {
      hooks.session.sessionReady = ready;
      const initial = render('');
      expect(host(initial.tree, 'input')!.disabled).toBe(true);
      expect(host(initial.tree, 'button')!.disabled).toBe(true);
      await settle();
      const hydrated = render('');
      expect(host(hydrated.tree, 'input')!.disabled).toBe(false);
      host(hydrated.tree, 'input')!.onChange({ target: { value: '  TESLA  ' } });
      const draft = render('');
      expect(host(draft.tree, 'button')!.disabled).toBe(false);
      host(draft.tree, 'form')!.onSubmit({ preventDefault: vi.fn() });
      await settle();
      expect(getAdKeyword).toHaveBeenCalledExactlyOnceWith('tesla');
    },
  );

  it('searches a normalized URL phrase without offering idle campaign actions', async () => {
    const query = '  TESLA—Motors xyz  ';
    const first = render(query);
    expect(host(first.tree, 'input')!.disabled).toBe(true);
    expect(host(first.tree, 'button')!.disabled).toBe(true);
    expect(first.html).not.toContain('/keyword-market/campaigns/new');
    expect(first.html).not.toContain('New stake');
    expect(first.html).not.toContain('keyword-market-resolver-empty-icon');
    expect(getAdKeyword).not.toHaveBeenCalled();
    await settle();
    expect(getAdKeyword).toHaveBeenCalledWith('tesla motors xyz');
    expect(getMyAdCampaigns).not.toHaveBeenCalled();
    expect(render(query).html).toContain(
      'href="/keyword-market/campaigns/new?keyword=tesla%20motors%20xyz"',
    );
  });

  it.each([false, true])(
    'waits for submission before showing campaign actions with ownership %s',
    async (owned) => {
      if (owned) {
        hooks.session.sessionAddress = rankingPosition.stakerAddress;
        vi.mocked(getMyAdCampaigns).mockResolvedValue([
          { id: 'campaign-1', keyword: 'tesla' } as Awaited<
            ReturnType<typeof getMyAdCampaigns>
          >[number],
        ]);
      }
      vi.mocked(getAdKeyword).mockResolvedValue({ ...ranking, positions: [rankingPosition] });
      render('');
      await settle();
      const initial = render('');
      host(initial.tree, 'input')!.onChange({ target: { value: '  TESLA  ' } });
      const draft = render('');
      expect(getAdKeyword).not.toHaveBeenCalled();
      expect(draft.html).toContain('Search a keyword to inspect');
      expect(draft.html).not.toContain('keyword-market-resolver-empty-icon');
      expect(draft.html).not.toContain('New stake');
      expect(draft.html).not.toContain('Create stake');
      expect(draft.html).not.toContain('Edit</a>');
      expect(draft.html).not.toContain('href="/keyword-market/campaigns/');
      host(draft.tree, 'form')!.onSubmit({ preventDefault: vi.fn() });
      await settle();
      expect(getAdKeyword).toHaveBeenCalledExactlyOnceWith('tesla');
      const html = render('').html;
      expect(html).toContain(owned ? 'Edit</a>' : 'New stake</a>');
      expect(html).toContain(
        owned
          ? 'href="/keyword-market/campaigns/campaign-1"'
          : 'href="/keyword-market/campaigns/new?keyword=tesla"',
      );
    },
  );

  it('keeps the searched ranking and Edit action unchanged while drafting another keyword', async () => {
    hooks.session.sessionAddress = rankingPosition.stakerAddress;
    vi.mocked(getMyAdCampaigns).mockResolvedValue([
      { id: 'campaign-1', keyword: 'tesla' } as Awaited<
        ReturnType<typeof getMyAdCampaigns>
      >[number],
    ]);
    vi.mocked(getAdKeyword).mockResolvedValue({ ...ranking, positions: [rankingPosition] });
    render();
    await settle();
    const current = render();
    host(current.tree, 'input')!.onChange({ target: { value: 'other phrase' } });
    const draft = render();
    expect(getAdKeyword).toHaveBeenCalledTimes(1);
    expect(draft.html).toContain('aria-label="USD bid ranking for tesla"');
    expect(draft.html).toContain('href="/keyword-market/campaigns/campaign-1"');
    expect(draft.html).toContain('Edit</a>');
    expect(draft.html).not.toContain('/campaigns/new?keyword=other');
    vi.mocked(getAdKeyword).mockResolvedValue({
      ...ranking,
      keyword: 'other phrase',
      positions: [rankingPosition],
    });
    host(draft.tree, 'form')!.onSubmit({ preventDefault: vi.fn() });
    await settle();
    const html = render().html;
    expect(getAdKeyword).toHaveBeenLastCalledWith('other phrase');
    expect(html).toContain('aria-label="USD bid ranking for other phrase"');
    expect(html).toContain('/campaigns/new?keyword=other%20phrase');
    expect(html).not.toContain('/campaigns/campaign-1');
  });

  it('offers stake creation through an owned paused campaign without duplicating it', async () => {
    hooks.session.sessionAddress = '0xowner';
    vi.mocked(getMyAdCampaigns).mockResolvedValue([
      { id: 'campaign-1', keyword: 'tesla', paused: true, position: null } as Awaited<
        ReturnType<typeof getMyAdCampaigns>
      >[number],
    ]);
    expect(render().html).not.toContain('Checking ownership');
    await settle();
    const html = render().html;
    expect(html).toContain('No stakes yet');
    expect(html).toContain('Create stake</a>');
    expect(html).toContain('href="/keyword-market/campaigns/campaign-1"');
    expect(html).not.toContain('/keyword-market/campaigns/new');
  });

  it('offers a visible Create stake action inside an empty ranking', async () => {
    render();
    await settle();
    const html = render().html;
    expect(html).toContain('No stakes yet');
    expect(html).toContain('Be the first to stake on this keyword.');
    expect(html).toContain('href="/keyword-market/campaigns/new?keyword=tesla"');
    expect(html).toContain('Create stake</a>');
    expect(html).not.toContain('keyword-market-result-heading-actions');
    expect(html).not.toContain('keyword-market-ranking-ledger');
  });

  it.each([true, false])('places Edit on the owned row with eligibility %s', async (eligible) => {
    hooks.session.sessionAddress = rankingPosition.stakerAddress.toUpperCase();
    vi.mocked(getMyAdCampaigns).mockResolvedValue([
      { id: 'campaign-1', keyword: 'tesla' } as Awaited<
        ReturnType<typeof getMyAdCampaigns>
      >[number],
    ]);
    vi.mocked(getAdKeyword).mockResolvedValue({
      ...ranking,
      positions: [
        { ...rankingPosition, stakerAddress: '0xcompetitor' },
        { ...rankingPosition, rank: 2, eligible },
      ],
    });
    render();
    await settle();
    const html = render().html;
    const rows = html.match(
      /<div class="keyword-market-ledger-row"[\s\S]*?(?=<div class="keyword-market-ledger-row"|<\/section>)/g,
    )!;
    expect(rows).toHaveLength(2);
    expect(rows[0]).not.toContain('/keyword-market/campaigns/campaign-1');
    expect(rows[1]).toContain('href="/keyword-market/campaigns/campaign-1"');
    expect(rows[1]).toContain('Edit</a>');
    expect(html).not.toContain('keyword-market-result-heading-actions');
  });

  it('keeps campaign management accessible when only competitors have positions', async () => {
    hooks.session.sessionAddress = '0xowner';
    vi.mocked(getMyAdCampaigns).mockResolvedValue([
      { id: 'campaign-1', keyword: 'tesla', position: null } as Awaited<
        ReturnType<typeof getMyAdCampaigns>
      >[number],
    ]);
    vi.mocked(getAdKeyword).mockResolvedValue({ ...ranking, positions: [rankingPosition] });
    render();
    await settle();
    const html = render().html;
    expect(html).toContain('href="/keyword-market/campaigns/campaign-1"');
    expect(html).toContain('Edit</a>');
    const row = html.match(/<div class="keyword-market-ledger-row"[\s\S]*?<\/section>/)![0];
    expect(row).not.toContain('/keyword-market/campaigns/campaign-1');
  });

  it('keeps stake creation and retries tied to a failed search while the draft changes', async () => {
    vi.mocked(getAdKeyword).mockRejectedValue(new Error('Ranking lookup failed'));
    render();
    await settle();
    const html = render().html;
    expect(html).toContain('Ranking lookup failed');
    expect(html).toContain('Try again');
    expect(html).toContain('href="/keyword-market/campaigns/new?keyword=tesla"');
    expect(html).toContain('New stake</a>');
    const current = render();
    host(current.tree, 'input')!.onChange({ target: { value: '!!!' } });
    const draft = render();
    expect(draft.html).toContain('Ranking lookup failed');
    expect(draft.html).toContain('href="/keyword-market/campaigns/new?keyword=tesla"');
    expect(getAdKeyword).toHaveBeenCalledTimes(1);
    vi.mocked(getAdKeyword).mockResolvedValue(ranking);
    host(draft.tree, ActionButton)!.onClick();
    await settle();
    expect(getAdKeyword).toHaveBeenCalledTimes(2);
    expect(getAdKeyword).toHaveBeenLastCalledWith('tesla');
    expect(render().html).toContain('No stakes yet');
    expect(render().html).not.toContain('Ranking lookup failed');
  });

  it('discards a pending old response only after another keyword is submitted', async () => {
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
    const draft = render();
    expect(draft.html).toContain('Searching…');
    expect(getAdKeyword).toHaveBeenCalledTimes(1);
    host(draft.tree, 'form')!.onSubmit({ preventDefault: vi.fn() });
    await settle();
    finish({
      ...ranking,
      positions: [{ ...rankingPosition, stakerAddress: '0xobsolete' }],
    });
    await settle();
    const next = render();
    expect(next.html).toContain('/campaigns/new?keyword=other%20phrase');
    expect(next.html).not.toContain('0xobsolete');
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
      expect(next.html).not.toContain('No stakes yet');
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
    [8453, 'https://basescan.org'],
    [84532, 'https://sepolia.basescan.org'],
  ] as const)('links proof to the explorer for ranking chain %s', (chainId, explorer) => {
    const html = renderToStaticMarkup(
      <KeywordMarketRanking data={{ ...ranking, chainId, positions: [rankingPosition] }} />,
    );
    expect(html).toContain(`href="${explorer}/tx/${rankingPosition.positionTxHash}"`);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer"');
    expect(html).toContain(`title="${rankingPosition.positionTxHash}"`);
    expect(html).toContain(
      `aria-label="View transaction ${rankingPosition.positionTxHash} in block explorer (opens in a new tab)"`,
    );
  });

  it('keeps proof readable without an explorer link for an unsupported chain', () => {
    const html = renderToStaticMarkup(
      <KeywordMarketRanking data={{ ...ranking, chainId: 1, positions: [rankingPosition] }} />,
    );
    expect(html).toContain(`<strong>${rankingPosition.positionBlock}</strong>`);
    expect(html).toContain(
      `<small title="${rankingPosition.positionTxHash}">${rankingPosition.positionTxHash.slice(0, 12)}…</small>`,
    );
    expect(html).not.toContain('<a ');
  });

  it.each([
    ['0xABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCD', true],
    ['0x0000000000000000000000000000000000000001', false],
    [undefined, false],
  ] as const)('marks the staker for matching session identity %s', (sessionAddress, isOwn) => {
    hooks.session.sessionAddress = sessionAddress;
    const html = renderToStaticMarkup(
      <KeywordMarketRanking data={{ ...ranking, positions: [rankingPosition] }} />,
    );
    expect(html.includes('(you)')).toBe(isOwn);
  });

  it.each([
    ['0', '0'],
    ['1000000000000000000', '1'],
    ['2500000000000000000', '2.5'],
    ['1', '0'],
    ['100000000000000001', '0.1'],
  ])('renders stake %s with at most four PRE decimal places', (raw, expected) => {
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
