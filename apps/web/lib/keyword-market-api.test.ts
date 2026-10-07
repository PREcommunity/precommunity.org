import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createAdApiKey,
  getAdApiKeys,
  isAdTransactionIndexed,
  revokeAdApiKey,
} from './keyword-market-api';

describe('API key administration requests', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses session credentials for metadata and creation without persisting secrets', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('[]'))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'new-key', name: 'Engine', apiKey: 'one-time-key' }), {
          status: 201,
        }),
      );
    vi.stubGlobal('fetch', fetch);
    expect(await getAdApiKeys()).toEqual([]);
    expect(await createAdApiKey('Engine')).toEqual({
      id: 'new-key',
      name: 'Engine',
      apiKey: 'one-time-key',
    });
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      expect.stringMatching(/\/v1\/keyword-market\/admin\/api-keys$/),
      { credentials: 'include' },
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      expect.stringMatching(/\/v1\/keyword-market\/admin\/api-keys$/),
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Engine' }),
        credentials: 'include',
      },
    );
  });

  it('encodes key IDs and accepts a successful empty revocation response', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetch);
    await expect(revokeAdApiKey('key/1')).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/v1\/keyword-market\/admin\/api-keys\/key%2F1$/),
      { method: 'DELETE', credentials: 'include' },
    );
  });
});

describe('keyword transaction projection confirmation', () => {
  const snapshot = { status: 'SYNCED' as const, indexedThroughBlock: '120' };
  const campaign = { chainStatus: 'SYNCED' as const, position: { positionBlock: '120' } };
  const receipt = { blockNumber: 120n, blockHash: `0x${'11'.repeat(32)}` };
  const projection = {
    chainStatus: 'SYNCED' as const,
    indexed: true,
    blockNumber: '120',
    blockHash: receipt.blockHash,
  };

  it('accepts the confirmed transaction and a later operator mutation', () => {
    expect(isAdTransactionIndexed(campaign, snapshot, projection, receipt)).toBe(true);
    const charged = { ...campaign, position: { positionBlock: '125', stakeRaw: '1' } };
    expect(
      isAdTransactionIndexed(
        charged,
        { ...snapshot, indexedThroughBlock: '125' },
        projection,
        receipt,
      ),
    ).toBe(true);
  });

  it('waits for a finalized cursor and the submitted transaction event', () => {
    expect(
      isAdTransactionIndexed(
        campaign,
        { ...snapshot, indexedThroughBlock: '119' },
        projection,
        receipt,
      ),
    ).toBe(false);
    expect(
      isAdTransactionIndexed(campaign, snapshot, { ...projection, indexed: false }, receipt),
    ).toBe(false);
  });

  it('accepts a closed position only once its transaction is indexed', () => {
    const closed = { ...campaign, position: null };
    expect(isAdTransactionIndexed(closed, snapshot, projection, receipt)).toBe(true);
    expect(
      isAdTransactionIndexed(
        closed,
        { ...snapshot, indexedThroughBlock: null },
        projection,
        receipt,
      ),
    ).toBe(false);
  });

  it('waits while any API view is syncing after a reorg', () => {
    expect(
      isAdTransactionIndexed(
        { ...campaign, chainStatus: 'SYNCING' },
        snapshot,
        projection,
        receipt,
      ),
    ).toBe(false);
    expect(
      isAdTransactionIndexed(campaign, { ...snapshot, status: 'SYNCING' }, projection, receipt),
    ).toBe(false);
    expect(
      isAdTransactionIndexed(
        campaign,
        snapshot,
        { ...projection, chainStatus: 'SYNCING' },
        receipt,
      ),
    ).toBe(false);
  });

  it('does not accept a later cursor or position when a reorg removed the submitted event', () => {
    const missing = { ...projection, indexed: false, blockNumber: null, blockHash: null };
    const later = { ...campaign, position: { positionBlock: '125' } };
    const closed = { ...campaign, position: null };
    const laterSnapshot = { ...snapshot, indexedThroughBlock: '125' };
    expect(isAdTransactionIndexed(later, laterSnapshot, missing, receipt)).toBe(false);
    expect(isAdTransactionIndexed(closed, laterSnapshot, missing, receipt)).toBe(false);
  });

  it('requires the original confirmed block hash and number', () => {
    expect(
      isAdTransactionIndexed(
        campaign,
        snapshot,
        { ...projection, blockHash: `0x${'22'.repeat(32)}` },
        receipt,
      ),
    ).toBe(false);
    expect(
      isAdTransactionIndexed(campaign, snapshot, { ...projection, blockNumber: '119' }, receipt),
    ).toBe(false);
  });
});
