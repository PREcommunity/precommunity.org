import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTH_CHANGED_EVENT } from '@/lib/auth-events';
import { ApiError } from '@/lib/http';
import { getKeywordMarketStatus, getMyAdCampaigns } from '@/lib/keyword-market-api';
import { KeywordMarketCampaignDetail } from './keyword-market-campaign-detail';
import { KeywordMarketCampaignList } from './keyword-market-campaign-list';

const hooks = vi.hoisted(() => ({
  effects: [] as Array<() => (() => void) | undefined>,
  states: [] as Array<{ initial: unknown; update: ReturnType<typeof vi.fn> }>,
}));

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useCallback: (callback: unknown) => callback,
  useEffect: (callback: () => (() => void) | undefined) => hooks.effects.push(callback),
  useId: () => 'campaign-refresh-test',
  useMemo: (calculate: () => unknown) => calculate(),
  useRef: (current: unknown) => ({ current }),
  useState: (value: unknown) => {
    const initial = typeof value === 'function' ? value() : value;
    const update = vi.fn();
    hooks.states.push({ initial, update });
    return [initial, update];
  },
}));

vi.mock('wagmi', () => ({
  useConfig: () => ({}),
  usePublicClient: () => null,
  useSendTransaction: () => ({ sendTransactionAsync: vi.fn() }),
  useSwitchChain: () => ({ switchChainAsync: vi.fn() }),
}));
vi.mock('@/hooks/use-wallet-session', () => ({ useWalletSession: () => ({}) }));
vi.mock('@/hooks/use-keyword-market-refresh', () => ({ useKeywordMarketRefresh: vi.fn() }));
vi.mock('@/lib/keyword-market-api', () => ({
  getMyAdCampaigns: vi.fn(),
  getKeywordMarketStatus: vi.fn(),
}));

describe('campaign refresh after authentication changes', () => {
  let cleanup: (() => void) | undefined;

  beforeEach(() => {
    hooks.effects.length = 0;
    hooks.states.length = 0;
    vi.clearAllMocks();
    vi.stubGlobal('window', new EventTarget());
    vi.mocked(getKeywordMarketStatus).mockResolvedValue({
      status: 'AWAITING_CONTRACT',
      chainId: 84532,
      contractAddress: null,
      deploymentBlock: null,
      transactionsEnabled: false,
      indexedThroughBlock: null,
      minimumStakeRaw: null,
      preTokenAddress: '0x0000000000000000000000000000000000000001',
    });
  });

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    vi.unstubAllGlobals();
  });

  it.each(['list', 'detail'] as const)(
    'replays the %s auth refresh after a delayed anonymous 401',
    async (view) => {
      let rejectAnonymousRequest!: (reason: unknown) => void;
      vi.mocked(getMyAdCampaigns)
        .mockImplementationOnce(
          () =>
            new Promise((_, reject) => {
              rejectAnonymousRequest = reject;
            }),
        )
        .mockResolvedValueOnce([
          { id: 'campaign-1', position: null } as Awaited<
            ReturnType<typeof getMyAdCampaigns>
          >[number],
        ]);

      if (view === 'list') KeywordMarketCampaignList();
      else KeywordMarketCampaignDetail({ campaignId: 'campaign-1' });
      const state = hooks.states.find(({ initial }) => initial === 'loading')!;
      cleanup = hooks.effects[0]!();
      expect(getMyAdCampaigns).toHaveBeenCalledOnce();

      window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
      expect(getMyAdCampaigns).toHaveBeenCalledOnce();
      rejectAnonymousRequest(new ApiError('Not signed in', 401));

      await vi.waitFor(() => {
        expect(getMyAdCampaigns).toHaveBeenCalledTimes(2);
        expect(state.update).toHaveBeenLastCalledWith('ready');
      });
    },
  );
});
