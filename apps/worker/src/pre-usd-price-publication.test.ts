import type { AdPricePublication, Prisma } from '@precommunity/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { keccak256 } from 'viem';
import {
  processPreUsdPricePublication,
  publicationQuote,
  type PricePublicationDependencies,
} from './pre-usd-price-publication';
import { PricePublicationBlocked } from './pre-usd-price-publication-chain';

vi.mock('./config', () => ({ config: {} }));

const now = new Date('2026-10-12T10:00:00Z');
const timestamp = BigInt(now.getTime() / 1000);
const contractAddress = `0x${'ab'.repeat(20)}`;
const hash = `0x${'cd'.repeat(32)}`;
const account = privateKeyToAccount(`0x${'11'.repeat(32)}`);
const raw = '0x0102' as const;
const txHash = keccak256(raw);

function row(overrides: Partial<AdPricePublication> = {}): AdPricePublication {
  return {
    id: 'publication-1',
    chainId: 84532,
    contractAddress,
    quoteId: 'quote-1',
    priceE18Raw: '557000000000000',
    quotedAt: timestamp,
    status: 'PREPARED',
    signerAddress: null,
    nonce: null,
    txHash: null,
    signedTransaction: null,
    receiptBlockNumber: null,
    receiptBlockHash: null,
    errorCode: null,
    attemptCount: 0,
    nextAttemptAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function fixture(initial: AdPricePublication[] = []) {
  const rows = initial.map((value) => ({ ...value }));
  const charges: Pick<
    AdPricePublication,
    'id' | 'chainId' | 'contractAddress' | 'signerAddress' | 'nonce' | 'status'
  >[] = [];
  const quote = {
    id: 'quote-1',
    source: 'COINGECKO',
    assetId: 'presearch',
    priceUsd: { toFixed: () => '0.000557' },
    quotedAt: now,
    fetchedAt: now,
  };
  type Where = Record<string, unknown>;
  function matches(value: Partial<AdPricePublication>, where: Where = {}) {
    return Object.entries(where).every(([key, expected]) => {
      const actual = value[key as keyof AdPricePublication];
      if (expected && typeof expected === 'object') {
        const filter = expected as { in?: unknown[]; not?: unknown; lte?: bigint };
        if (filter.in) return filter.in.includes(actual);
        if ('not' in filter) return actual !== filter.not;
        if (filter.lte !== undefined) return typeof actual === 'bigint' && actual <= filter.lte;
      }
      return actual === expected;
    });
  }
  function find(args: { where?: Where; orderBy?: Record<string, string> }) {
    const found = rows.filter((value) => matches(value, args.where));
    const order = Object.entries(args.orderBy ?? {})[0];
    if (order)
      found.sort((left, right) => {
        const a = left[order[0] as keyof AdPricePublication] ?? 0;
        const b = right[order[0] as keyof AdPricePublication] ?? 0;
        return (a < b ? -1 : a > b ? 1 : 0) * (order[1] === 'desc' ? -1 : 1);
      });
    return found;
  }
  const publications = {
    findMany: vi.fn(async (args: Parameters<typeof find>[0]) =>
      find(args).map((value) => ({ ...value })),
    ),
    findFirst: vi.fn(async (args: Parameters<typeof find>[0]) =>
      find(args)[0] ? { ...find(args)[0]! } : null,
    ),
    findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => ({
      ...rows.find((value) => value.id === where.id)!,
    })),
    upsert: vi.fn(
      async ({
        where,
        create,
      }: {
        where: { chainId_contractAddress_quotedAt: Where };
        create: Partial<AdPricePublication>;
      }) => {
        let saved = rows.find((value) => matches(value, where.chainId_contractAddress_quotedAt));
        if (!saved) {
          saved = row({ ...create, id: `publication-${rows.length + 1}` });
          rows.push(saved);
        }
        return { ...saved };
      },
    ),
    update: vi.fn(
      async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const saved = rows.find((value) => value.id === where.id)!;
        const { attemptCount, ...rest } = data;
        Object.assign(saved, rest);
        if (attemptCount && typeof attemptCount === 'object')
          saved.attemptCount += Number((attemptCount as { increment: number }).increment);
        return { ...saved };
      },
    ),
    updateMany: vi.fn(async ({ where, data }: { where: Where; data: Record<string, unknown> }) => {
      const found = rows.filter((value) => matches(value, where));
      for (const saved of found) Object.assign(saved, data);
      return { count: found.length };
    }),
  };
  const database = {
    adPricePublication: publications,
    adChargeBatch: {
      findFirst: vi.fn(async (args: Parameters<typeof find>[0]) => {
        const found = charges.filter((value) => matches(value, args.where));
        if (args.orderBy?.nonce === 'desc')
          found.sort((left, right) => ((left.nonce ?? 0n) > (right.nonce ?? 0n) ? -1 : 1));
        return found[0] ? { ...found[0] } : null;
      }),
    },
    preUsdPrice: { findFirst: vi.fn().mockResolvedValue(quote) },
    $executeRaw: vi.fn<(query: Prisma.Sql) => Promise<number>>().mockResolvedValue(1),
    $transaction: vi.fn(async (action: (tx: unknown) => Promise<unknown>) => action(database)),
  };
  const chain = {
    head: vi.fn().mockResolvedValue(100n),
    blockHash: vi.fn().mockResolvedValue(hash),
    verify: vi.fn().mockResolvedValue(undefined),
    price: vi.fn().mockResolvedValue({ priceE18: 0n, quotedAt: 0n }),
    authorities: vi
      .fn()
      .mockResolvedValue({ updater: account.address, operator: `0x${'22'.repeat(20)}` }),
    receipt: vi.fn().mockResolvedValue(null),
    nonce: vi.fn().mockResolvedValue(0n),
    sign: vi.fn().mockResolvedValue({ raw, hash: txHash }),
    broadcast: vi.fn().mockResolvedValue(txHash),
  };
  const deps: PricePublicationDependencies = {
    chain,
    unlock: vi.fn().mockResolvedValue(account),
    now,
    chainId: 84532,
    contractAddress,
    confirmations: 2,
  };
  const run = () => processPreUsdPricePublication(database as never, deps);
  return { rows, charges, database, chain, deps, run, quote };
}

beforeEach(() => vi.clearAllMocks());

describe('durable PRE/USD publication', () => {
  it('persists signed bytes and the signer nonce before the first broadcast', async () => {
    const f = fixture();
    f.chain.broadcast.mockImplementation(async (sent) => {
      expect(sent).toBe(raw);
      expect(f.rows[0]).toMatchObject({
        status: 'SIGNED',
        signedTransaction: raw,
        txHash,
        nonce: 0n,
      });
      return txHash;
    });
    expect(await f.run()).toEqual({
      outcome: 'WAITING_CONFIRMATION',
      errorCode: 'WAITING_CONFIRMATION',
    });
    expect(f.database.$executeRaw).toHaveBeenCalledOnce();
    expect(f.database.$executeRaw.mock.calls[0]![0].values).toEqual([
      `keyword-market-wallet:${f.deps.chainId}:${account.address.toLowerCase()}`,
    ]);
    expect(f.chain.sign).toHaveBeenCalledOnce();
    expect(f.rows[0]).toMatchObject({ status: 'SUBMITTED', attemptCount: 1 });
  });

  it('resumes the same raw transaction after ambiguous acceptance without signing again or fetching a price', async () => {
    const f = fixture();
    f.chain.broadcast.mockRejectedValueOnce(new PricePublicationBlocked('TRANSACTION_UNKNOWN'));
    await f.run();
    expect(f.rows[0]).toMatchObject({ status: 'RECONCILING', errorCode: 'TRANSACTION_UNKNOWN' });
    f.database.preUsdPrice.findFirst.mockResolvedValue(null);
    await f.run();
    expect(f.chain.sign).toHaveBeenCalledOnce();
    expect(f.chain.broadcast.mock.calls).toEqual([[raw], [raw]]);
    expect(f.database.preUsdPrice.findFirst).toHaveBeenCalledOnce();
  });

  it('waits for canonical confirmations and checks the exact price update event', async () => {
    const f = fixture();
    await f.run();
    f.chain.receipt.mockResolvedValue({
      blockNumber: 100n,
      blockHash: hash,
      reverted: false,
      event: { priceE18: 557000000000000n, quotedAt: timestamp },
    });
    await f.run();
    expect(f.rows[0]!.status).toBe('RECONCILING');
    f.chain.head.mockResolvedValue(101n);
    f.chain.price.mockResolvedValue({ priceE18: 557000000000000n, quotedAt: timestamp });
    expect(await f.run()).toEqual({ outcome: 'UNCHANGED', errorCode: null });
    expect(f.rows[0]).toMatchObject({
      status: 'CONFIRMED',
      errorCode: null,
      receiptBlockNumber: 100n,
      receiptBlockHash: hash,
    });
    expect(f.chain.broadcast).toHaveBeenCalledOnce();
  });

  it('does not acknowledge an unrelated event even in a successful receipt', async () => {
    const f = fixture([
      row({
        status: 'SIGNED',
        signerAddress: account.address.toLowerCase(),
        nonce: 0n,
        txHash,
        signedTransaction: raw,
      }),
    ]);
    f.chain.receipt.mockResolvedValue({
      blockNumber: 90n,
      blockHash: hash,
      reverted: false,
      event: { priceE18: 1n, quotedAt: timestamp },
    });
    expect(await f.run()).toEqual({ outcome: 'BLOCKED', errorCode: 'TRANSACTION_UNKNOWN' });
    expect(f.chain.sign).not.toHaveBeenCalled();
    expect(f.rows[0]!.status).toBe('RECONCILING');
  });

  it('confirms a successful duplicate update by its exact state when the contract emits no event', async () => {
    const f = fixture([
      row({
        status: 'SIGNED',
        signerAddress: account.address.toLowerCase(),
        nonce: 0n,
        txHash,
        signedTransaction: raw,
      }),
    ]);
    f.chain.receipt.mockResolvedValue({
      blockNumber: 90n,
      blockHash: hash,
      reverted: false,
      event: null,
    });
    f.chain.price.mockResolvedValue({ priceE18: 557000000000000n, quotedAt: timestamp });
    expect(await f.run()).toEqual({ outcome: 'UNCHANGED', errorCode: null });
    expect(f.rows[0]!.status).toBe('CONFIRMED');
    expect(f.chain.price).toHaveBeenCalledWith(90n);
    expect(f.chain.sign).not.toHaveBeenCalled();
  });

  it('does not republish duplicate or older quotes, including a prepared row superseded manually', async () => {
    const f = fixture([row()]);
    f.chain.price.mockResolvedValue({ priceE18: 557000000000000n, quotedAt: timestamp + 1n });
    expect(await f.run()).toEqual({ outcome: 'UNCHANGED', errorCode: null });
    expect(f.rows[0]!.status).toBe('SUPERSEDED');
    expect(f.chain.sign).not.toHaveBeenCalled();
    expect(f.deps.unlock).not.toHaveBeenCalled();
  });

  it('uses the last validated quote even when it is stale', async () => {
    const f = fixture();
    f.deps.now = new Date(now.getTime() + 60 * 60_000);
    await f.run();
    expect(f.chain.sign).toHaveBeenCalledOnce();
    expect(f.rows[0]!.quotedAt).toBe(timestamp);
  });

  it.each(['KEYSTORE_MISSING', 'KEYSTORE_INVALID'])(
    'blocks safely when updater cannot be unlocked: %s',
    async (code) => {
      const f = fixture();
      (f.deps.unlock as ReturnType<typeof vi.fn>).mockRejectedValue(
        new PricePublicationBlocked(code),
      );
      expect(await f.run()).toEqual({ outcome: 'BLOCKED', errorCode: code });
      expect(f.rows[0]!.errorCode).toBe(code);
      expect(f.chain.sign).not.toHaveBeenCalled();
    },
  );

  it('requires the configured updater and an account distinct from the charge operator', async () => {
    const f = fixture();
    f.chain.authorities.mockResolvedValue({
      updater: `0x${'33'.repeat(20)}`,
      operator: `0x${'22'.repeat(20)}`,
    });
    expect(await f.run()).toEqual({ outcome: 'BLOCKED', errorCode: 'PRICE_UPDATER_MISMATCH' });
    f.chain.authorities.mockResolvedValue({ updater: account.address, operator: account.address });
    expect(await f.run()).toEqual({ outcome: 'BLOCKED', errorCode: 'PRICE_UPDATER_NOT_DEDICATED' });
    expect(f.chain.sign).not.toHaveBeenCalled();
  });

  it.each([
    {
      updater: `0x${'33'.repeat(20)}`,
      operator: `0x${'22'.repeat(20)}`,
      code: 'PRICE_UPDATER_MISMATCH',
    },
    { updater: account.address, operator: account.address, code: 'PRICE_UPDATER_NOT_DEDICATED' },
  ])(
    'stops rebroadcast when saved signer authority changes: $code',
    async ({ updater, operator, code }) => {
      const f = fixture([
        row({
          status: 'SIGNED',
          signerAddress: account.address.toLowerCase(),
          nonce: 0n,
          txHash,
          signedTransaction: raw,
        }),
      ]);
      f.chain.authorities.mockResolvedValue({ updater, operator });
      expect(await f.run()).toEqual({ outcome: 'BLOCKED', errorCode: code });
      expect(f.chain.broadcast).not.toHaveBeenCalled();
      expect(f.chain.sign).not.toHaveBeenCalled();
      expect(f.rows[0]).toMatchObject({
        status: 'RECONCILING',
        errorCode: code,
        txHash,
        signedTransaction: raw,
        nonce: 0n,
      });
    },
  );

  it('does not reserve a nonce while another deployment is using the same updater', async () => {
    const f = fixture([
      row({
        contractAddress: `0x${'44'.repeat(20)}`,
        status: 'SIGNED',
        signerAddress: account.address.toLowerCase(),
        nonce: 0n,
        txHash,
        signedTransaction: raw,
      }),
    ]);
    expect(await f.run()).toEqual({
      outcome: 'WAITING_CONFIRMATION',
      errorCode: 'WAITING_CONFIRMATION',
    });
    expect(f.chain.sign).not.toHaveBeenCalled();
  });

  it.each(['SIGNED', 'SUBMITTED', 'RECONCILING'])(
    'does not sign a price publication while its updater has a %s charge',
    async (status) => {
      const f = fixture();
      f.charges.push({
        id: 'old-operator-charge',
        chainId: f.deps.chainId,
        contractAddress: `0x${'44'.repeat(20)}`,
        signerAddress: account.address.toLowerCase(),
        nonce: 0n,
        status,
      });
      expect(await f.run()).toEqual({
        outcome: 'WAITING_CONFIRMATION',
        errorCode: 'WAITING_CONFIRMATION',
      });
      expect(f.chain.sign).not.toHaveBeenCalled();
      expect(f.chain.broadcast).not.toHaveBeenCalled();
      expect(f.rows[0]).toMatchObject({ status: 'PREPARED', nonce: null });
      expect(f.charges[0]).toMatchObject({ status, nonce: 0n });
    },
  );

  it.each(['CONFIRMED', 'FAILED', 'PARTIAL', 'UNCOLLECTABLE'])(
    'does not reuse the saved nonce of a %s charge after the RPC loses it',
    async (status) => {
      const f = fixture();
      f.charges.push({
        id: 'old-operator-charge',
        chainId: f.deps.chainId,
        contractAddress,
        signerAddress: account.address.toLowerCase(),
        nonce: 0n,
        status,
      });
      expect(await f.run()).toEqual({ outcome: 'BLOCKED', errorCode: 'NONCE_GAP' });
      expect(f.chain.sign).not.toHaveBeenCalled();
      expect(f.chain.broadcast).not.toHaveBeenCalled();
    },
  );

  it('signs a price publication after the former operator charge nonce has been consumed', async () => {
    const f = fixture();
    f.charges.push({
      id: 'old-operator-charge',
      chainId: f.deps.chainId,
      contractAddress,
      signerAddress: account.address.toLowerCase(),
      nonce: 0n,
      status: 'CONFIRMED',
    });
    f.chain.nonce.mockResolvedValue(1n);
    await f.run();
    expect(f.chain.sign.mock.calls[0]![2]).toBe(1n);
    expect(f.rows[0]).toMatchObject({ status: 'SUBMITTED', nonce: 1n });
  });

  it('blocks an unexplained consumed nonce and never replaces an unresolved transaction', async () => {
    const f = fixture([
      row({
        status: 'SIGNED',
        signerAddress: account.address.toLowerCase(),
        nonce: 0n,
        txHash,
        signedTransaction: raw,
      }),
    ]);
    f.chain.nonce.mockResolvedValue(1n);
    expect(await f.run()).toEqual({ outcome: 'BLOCKED', errorCode: 'NONCE_CONSUMED' });
    expect(f.chain.sign).not.toHaveBeenCalled();
    expect(f.chain.broadcast).not.toHaveBeenCalled();
  });

  it('resumes a previously confirmed transaction when its receipt block is reorganized', async () => {
    const f = fixture([
      row({
        status: 'CONFIRMED',
        signerAddress: account.address.toLowerCase(),
        nonce: 0n,
        txHash,
        signedTransaction: raw,
        receiptBlockNumber: 90n,
        receiptBlockHash: `0x${'ee'.repeat(32)}`,
      }),
    ]);
    expect(await f.run()).toEqual({
      outcome: 'WAITING_CONFIRMATION',
      errorCode: 'WAITING_CONFIRMATION',
    });
    expect(f.chain.broadcast).toHaveBeenCalledWith(raw);
    expect(f.chain.sign).not.toHaveBeenCalled();
  });

  it('recovers the latest receipt after updater rotation even when the old signer had a higher nonce', async () => {
    const f = fixture([
      row({
        id: 'old-wallet',
        quotedAt: timestamp - 60n,
        status: 'CONFIRMED',
        signerAddress: `0x${'55'.repeat(20)}`,
        nonce: 100n,
        txHash: '0xoldhash',
        signedTransaction: '0xoldraw',
        receiptBlockNumber: 80n,
        receiptBlockHash: hash,
      }),
      row({
        id: 'new-wallet',
        status: 'CONFIRMED',
        signerAddress: account.address.toLowerCase(),
        nonce: 0n,
        txHash,
        signedTransaction: raw,
        receiptBlockNumber: 90n,
        receiptBlockHash: `0x${'ee'.repeat(32)}`,
      }),
    ]);
    expect(await f.run()).toEqual({
      outcome: 'WAITING_CONFIRMATION',
      errorCode: 'WAITING_CONFIRMATION',
    });
    expect(f.chain.blockHash).toHaveBeenCalledWith(90n);
    expect(f.chain.broadcast).toHaveBeenCalledWith(raw);
    expect(f.chain.sign).not.toHaveBeenCalled();
    expect(f.rows[1]).toMatchObject({ status: 'SUBMITTED', nonce: 0n, txHash });
  });

  it('also recovers a reverted transaction whose receipt was subsequently reorganized', async () => {
    const f = fixture([
      row({
        status: 'FAILED',
        signerAddress: account.address.toLowerCase(),
        nonce: 0n,
        txHash,
        signedTransaction: raw,
        receiptBlockNumber: 90n,
        receiptBlockHash: `0x${'ee'.repeat(32)}`,
        nextAttemptAt: new Date(now.getTime() + 60_000),
      }),
    ]);
    expect(await f.run()).toEqual({
      outcome: 'WAITING_CONFIRMATION',
      errorCode: 'WAITING_CONFIRMATION',
    });
    expect(f.chain.broadcast).toHaveBeenCalledWith(raw);
    expect(f.chain.sign).not.toHaveBeenCalled();
  });

  it('backs off after a finalized revert and retries with the next consumed nonce', async () => {
    const f = fixture([
      row({
        status: 'SIGNED',
        signerAddress: account.address.toLowerCase(),
        nonce: 0n,
        txHash,
        signedTransaction: raw,
      }),
    ]);
    f.chain.receipt.mockResolvedValue({
      blockNumber: 90n,
      blockHash: hash,
      reverted: true,
      event: null,
    });
    expect(await f.run()).toEqual({ outcome: 'BLOCKED', errorCode: 'TRANSACTION_FAILED' });
    expect(f.chain.sign).not.toHaveBeenCalled();
    f.deps.now = new Date(now.getTime() + 60_000);
    f.chain.receipt.mockResolvedValue(null);
    f.chain.nonce.mockResolvedValue(1n);
    await f.run();
    expect(f.chain.sign.mock.calls[0]![2]).toBe(1n);
    expect(f.rows[0]!.nonce).toBe(1n);
  });

  it('does not send against a contract that fails structural verification', async () => {
    const f = fixture();
    f.chain.verify.mockRejectedValue(new PricePublicationBlocked('CONTRACT_MISMATCH'));
    expect(await f.run()).toEqual({ outcome: 'BLOCKED', errorCode: 'CONTRACT_MISMATCH' });
    expect(f.chain.broadcast).not.toHaveBeenCalled();
  });
});

describe('price encoding', () => {
  const quote = {
    id: 'quote-1',
    source: 'COINGECKO' as const,
    assetId: 'presearch' as const,
    priceUsd: '0.123456789012345678',
    quotedAt: now.toISOString(),
    fetchedAt: now.toISOString(),
  };
  it('preserves all eighteen decimals without floating point conversion', () => {
    expect(publicationQuote(quote, now)).toEqual({
      priceE18Raw: '123456789012345678',
      quotedAt: timestamp,
      quoteId: 'quote-1',
    });
  });
  it.each(['0', '-1', '1e-3', '0.1234567890123456789', 'broken'])(
    'rejects invalid price %s',
    (priceUsd) => {
      expect(() => publicationQuote({ ...quote, priceUsd }, now)).toThrow('PRICE_UNAVAILABLE');
    },
  );
});
