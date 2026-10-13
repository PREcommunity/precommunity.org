import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PreUsdPricePanel } from './pre-usd-price-panel';
import type { PreUsdPriceAdminView } from '@precommunity/shared';

const state = vi.hoisted(() => ({
  value: {
    view: {
      status: 'FRESH' as 'FRESH' | 'STALE' | 'MISSING',
      collectorEnabled: true,
      contract: undefined as PreUsdPriceAdminView['contract'],
      quote: {
        id: 'quote-1',
        source: 'COINGECKO',
        assetId: 'presearch',
        priceUsd: '0.004567890123456789',
        quotedAt: '2026-10-09T10:00:00.000Z',
        fetchedAt: '2026-10-09T10:01:00.000Z',
      } as {
        id: string;
        source: string;
        assetId: string;
        priceUsd: string;
        quotedAt: string;
        fetchedAt: string;
      } | null,
    },
    loading: false,
    pending: false,
    refreshState: 'QUEUED' as 'QUEUED' | 'RUNNING',
    cooldown: false,
    notice: null,
    refresh: vi.fn(),
  },
  hook: vi.fn(),
}));

vi.mock('@/hooks/use-pre-usd-price', () => ({
  usePreUsdPrice: (canRefresh: boolean) => {
    state.hook(canRefresh);
    return state.value;
  },
}));

describe('PRE price panel', () => {
  beforeEach(() => {
    state.hook.mockClear();
    state.value.view.status = 'FRESH';
    state.value.view.collectorEnabled = true;
    state.value.view.contract = undefined;
    state.value.view.quote = {
      id: 'quote-1',
      source: 'COINGECKO',
      assetId: 'presearch',
      priceUsd: '0.004567890123456789',
      quotedAt: '2026-10-09T10:00:00.000Z',
      fetchedAt: '2026-10-09T10:01:00.000Z',
    };
    state.value.loading = false;
    state.value.pending = false;
    state.value.refreshState = 'QUEUED';
    state.value.cooldown = false;
  });

  it('shows the exact decimal price, CoinGecko source, quote time and collection time', () => {
    const html = renderToStaticMarkup(<PreUsdPricePanel canRefresh />);
    expect(html).toContain('0.004567890123456789 USD');
    expect(html).toContain('CoinGecko');
    expect(html).toContain('dateTime="2026-10-09T10:00:00.000Z"');
    expect(html).toContain('dateTime="2026-10-09T10:01:00.000Z"');
    expect(html).toContain('Current');
  });

  it('keeps an old price visible and marks it out of date', () => {
    state.value.view.status = 'STALE';
    const html = renderToStaticMarkup(<PreUsdPricePanel canRefresh />);
    expect(html).toContain('0.004567890123456789 USD');
    expect(html).toContain('Out of date');
    expect(html).toContain('A current quote is not available');
  });

  it('shows missing data without inventing a price or timestamp', () => {
    state.value.view.status = 'MISSING';
    state.value.view.quote = null;
    const html = renderToStaticMarkup(<PreUsdPricePanel canRefresh />);
    expect(html).toContain('No quote');
    expect(html).not.toContain('<time');
    expect(html).not.toContain('0.004');
  });

  it('exposes the manual button only to SUPER_ADMIN', () => {
    const html = renderToStaticMarkup(<PreUsdPricePanel canRefresh={false} />);
    expect(html).not.toContain('<button');
    expect(html).toContain('Only SUPER_ADMIN can refresh');
    expect(state.hook).toHaveBeenCalledWith(false);
  });

  it('disables the button for unconfigured collection without showing a secret', () => {
    state.value.view.collectorEnabled = false;
    const html = renderToStaticMarkup(<PreUsdPricePanel canRefresh />);
    expect(html).toContain('disabled=""');
    expect(html).toContain('Price updates are not configured');
    expect(html).not.toContain('API_KEY');
  });

  it('shows queued and running tasks as pending and blocks another click', () => {
    state.value.pending = true;
    let html = renderToStaticMarkup(<PreUsdPricePanel canRefresh />);
    expect(html).toContain('Waiting for worker');
    expect(html).toContain('disabled=""');
    state.value.refreshState = 'RUNNING';
    html = renderToStaticMarkup(<PreUsdPricePanel canRefresh />);
    expect(html).toContain('Updating price');
  });

  it('disables manual refresh during the cooldown', () => {
    state.value.cooldown = true;
    expect(renderToStaticMarkup(<PreUsdPricePanel canRefresh />)).toContain('disabled=""');
  });

  it.each([8453, 84532])(
    'distinguishes the contract quote and pending publication on chain %s',
    (chainId) => {
      state.value.view.contract = {
        chainId,
        address: '0xmarket',
        priceUsd: '0.001',
        quotedAt: '2026-10-09T10:00:00.000Z',
        status: 'STALE',
        updaterAddress: '0xupdater',
        updaterGasBalanceRaw: null,
        publication: {
          status: 'SUBMITTED',
          txHash: `0x${'a'.repeat(64)}`,
          errorCode: 'WAITING_CONFIRMATION',
          quotedAt: '2026-10-09T10:00:00.000Z',
        },
      };
      const html = renderToStaticMarkup(<PreUsdPricePanel canRefresh />);
      expect(html).toContain('0.001 USD');
      expect(html).toContain('0.004567890123456789 USD');
      expect(html).toContain('Older quote · still in use');
      expect(html).toContain('SUBMITTED');
      expect(html).toContain(`href="https://${chainId === 8453 ? '' : 'sepolia.'}basescan.org/tx/`);
      expect(html).toContain('waiting for confirmations');
    },
  );

  it.each([8453, 84532])(
    'shows the updater wallet and exact ETH balance on chain %s',
    (chainId) => {
      const address = `0x${'12'.repeat(20)}`;
      state.value.view.contract = {
        chainId,
        address: '0xmarket',
        priceUsd: '0.001',
        quotedAt: '2026-10-09T10:00:00.000Z',
        status: 'FRESH',
        updaterAddress: address,
        updaterGasBalanceRaw: '123456789012345678',
        publication: null,
      };
      const html = renderToStaticMarkup(<PreUsdPricePanel canRefresh />);
      expect(html).toContain('Price updater wallet:');
      expect(html).toContain(`<span class="font-mono">${address}</span>`);
      expect(html).toContain('0.123456789012345678 ETH available for fees');
      expect(html).toContain('break-all');
      expect(html).not.toContain('ETH balance unavailable');
    },
  );

  it.each([
    ['0', '0 ETH available for fees'],
    [null, 'ETH balance unavailable'],
    [undefined, 'ETH balance unavailable'],
  ])('distinguishes zero ETH from an unavailable updater balance (%s)', (raw, expected) => {
    state.value.view.contract = {
      chainId: 8453,
      address: '0xmarket',
      priceUsd: '0.001',
      quotedAt: null,
      status: 'FRESH',
      updaterAddress: `0x${'12'.repeat(20)}`,
      updaterGasBalanceRaw: raw as string | null,
      publication: null,
    };
    const html = renderToStaticMarkup(<PreUsdPricePanel canRefresh />);
    expect(html).toContain(expected);
    if (raw === null || raw === undefined) expect(html).not.toContain('0 ETH available for fees');
  });

  it.each([null, '', `0x${'0'.repeat(40)}`])(
    'omits the wallet line when no updater role is configured (%s)',
    (address) => {
      state.value.view.contract = {
        chainId: 8453,
        address: '0xmarket',
        priceUsd: '0.001',
        quotedAt: null,
        status: 'FRESH',
        updaterAddress: address,
        updaterGasBalanceRaw: '1000000000000000000',
        publication: null,
      };
      expect(renderToStaticMarkup(<PreUsdPricePanel canRefresh />)).not.toContain(
        'Price updater wallet:',
      );
    },
  );
});
