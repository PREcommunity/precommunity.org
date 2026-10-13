import {
  Prisma,
  type AdBillingClick,
  type AdChargeBatch,
  type AdChargeRun,
  type AdChargeSettings,
  type AdPricePublication,
} from '@precommunity/database';
import { privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it, vi } from 'vitest';
import { ChargeBlocked, type ChargeReceipt } from './keyword-market-charges-chain';
import {
  chargeGroupDue,
  processAdChargeJob,
  reconcileChargeBatch,
  type ChargeDependencies,
} from './keyword-market-charges';

vi.mock('./config', () => ({ config: { adsContract: { address: null } } }));

const now = new Date('2026-10-11T10:00:00Z');
const identity = { chainId: 84532, contractAddress: `0x${'ab'.repeat(20)}` };
const signer = privateKeyToAccount(`0x${'11'.repeat(32)}`);
const keywordId = `0x${'cd'.repeat(32)}`;
const chargeId = `0x${'ef'.repeat(32)}`;

type Row = Record<string, unknown>;
function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (key === 'OR') return (expected as Row[]).some((clause) => matches(row, clause));
    const value = row[key];
    if (expected !== null && typeof expected === 'object' && !(expected instanceof Date)) {
      const ops = expected as {
        in?: unknown[];
        not?: unknown;
        gt?: number;
        lt?: Date;
        lte?: Date | bigint;
      };
      if (ops.in) return ops.in.includes(value);
      if ('not' in ops) return value !== ops.not;
      if (ops.lt) return (value as Date) < ops.lt;
      if (ops.lte !== undefined) return value !== null && (value as Date) <= (ops.lte as Date);
      if (ops.gt !== undefined) return (value as number) > ops.gt;
    }
    return value === expected;
  });
}

function data<T>(row: T, update: Row) {
  for (const [key, value] of Object.entries(update)) {
    (row as Row)[key] =
      value && typeof value === 'object' && 'increment' in value
        ? Number((row as Row)[key]) + Number(value.increment)
        : value;
  }
  return { ...row };
}

function click(index = 1, overrides: Partial<AdBillingClick> = {}): AdBillingClick {
  return {
    id: `click-${index}`,
    revisionId: 'revision',
    ...identity,
    keywordId,
    keyword: 'search',
    stakerAddress: signer.address.toLowerCase(),
    positionVersion: 2n,
    status: 'PENDING',
    bidUsdRaw: '100000',
    amountPreRaw: '10',
    priceQuoteId: null,
    priceUsd: null,
    priceQuotedAt: null,
    captureSource: 'CHAIN',
    bidBlockNumber: 80n,
    bidBlockHash: '0xblock',
    priceBlockNumber: null,
    priceBlockHash: null,
    errorCode: null,
    batchId: null,
    clickedAt: new Date(now.getTime() - 10 * 60_000),
    updatedAt: now,
    ...overrides,
  };
}

function batch(overrides: Partial<AdChargeBatch> = {}): AdChargeBatch {
  return {
    id: 'batch-1',
    runId: 'run-1',
    chargeId,
    ...identity,
    keywordId,
    keyword: 'search',
    stakerAddress: signer.address.toLowerCase(),
    positionVersion: 2n,
    clickCount: 1,
    duePreRaw: '10',
    requestedPreRaw: '10',
    chargedPreRaw: null,
    shortfallPreRaw: null,
    status: 'SUBMITTED',
    txHash: '0xhash',
    signedTransaction: '0x1234',
    nonce: 3n,
    settledTxHash: null,
    signerAddress: signer.address.toLowerCase(),
    receiptBlockNumber: null,
    receiptBlockHash: null,
    errorCode: null,
    attemptCount: 1,
    nextAttemptAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function run(overrides: Partial<AdChargeRun> = {}): AdChargeRun {
  return {
    id: 'run-1',
    ...identity,
    trigger: 'MANUAL',
    status: 'QUEUED',
    actorAddress: null,
    errorCode: null,
    startedAt: null,
    finishedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function receipt(overrides: Partial<ChargeReceipt> = {}): ChargeReceipt {
  return {
    blockNumber: 80n,
    blockHash: '0xblock',
    reverted: false,
    event: { chargeId, keywordId, staker: signer.address, requestedPre: 10n, chargedPre: 10n },
    ...overrides,
  };
}

function indexedCharge() {
  return {
    ...identity,
    eventName: 'StakeCharged',
    txHash: '0xoriginal-success',
    logIndex: 0,
    blockNumber: 80n,
    blockHash: '0xblock',
    payload: {
      chargeId,
      keywordId,
      staker: signer.address.toLowerCase(),
      requestedPre: '10',
      chargedPre: '10',
      remainingPre: '90',
    },
  };
}

function fixture() {
  const clicks: AdBillingClick[] = [];
  const batches: AdChargeBatch[] = [];
  const runs: AdChargeRun[] = [];
  const publications: Pick<
    AdPricePublication,
    'id' | 'chainId' | 'contractAddress' | 'signerAddress' | 'nonce' | 'status'
  >[] = [];
  const events: string[] = [];
  const settings: AdChargeSettings = {
    ...identity,
    automaticEnabled: false,
    intervalMinutes: 10,
    clickThreshold: 50,
    updatedBy: null,
    workerHeartbeatAt: null,
    signerAddress: null,
    operatorAddress: null,
    gasBalanceRaw: null,
    readiness: 'WORKER_UNAVAILABLE',
    errorCode: null,
    createdAt: now,
    updatedAt: now,
    reconciliationBlockNumber: null,
    reconciliationBlockHash: null,
  };
  let quote: {
    id: string;
    source: string;
    assetId: string;
    priceUsd: Prisma.Decimal;
    quotedAt: Date;
    fetchedAt: Date;
  } | null = null;
  function collection<T>(rows: T[], factory: (value: Partial<T>) => T) {
    const findMany = vi.fn(
      async ({
        where,
        orderBy,
        take,
      }: { where?: Row; orderBy?: Row | Row[]; take?: number } = {}) => {
        const found = rows.filter((row) => matches(row as Row, where));
        for (const field of Array.isArray(orderBy) ? orderBy.slice().reverse() : [orderBy]) {
          if (!field) continue;
          const [key, direction] = Object.entries(field)[0]!;
          found.sort((a, b) => {
            const left = (a as Row)[key] as number;
            const right = (b as Row)[key] as number;
            return (left < right ? -1 : left > right ? 1 : 0) * (direction === 'desc' ? -1 : 1);
          });
        }
        return found.slice(0, take).map((row) => ({ ...row }));
      },
    );
    return {
      findMany,
      findFirst: vi.fn(
        async (args: Parameters<typeof findMany>[0]) => (await findMany(args))[0] ?? null,
      ),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: Row }) => {
        const saved = rows.find((row) => matches(row as Row, where));
        if (!saved) throw new Error('Missing row');
        return { ...saved };
      }),
      create: vi.fn(async ({ data: value }: { data: Partial<T> }) => {
        const saved = factory(value);
        rows.push(saved);
        return { ...saved };
      }),
      update: vi.fn(async ({ where, data: values }: { where: Row; data: Row }) => {
        const saved = rows.find((row) => matches(row as Row, where));
        if (!saved) throw new Error('Missing row');
        if (values.signedTransaction) events.push('persist-signature');
        return data(saved, values);
      }),
      updateMany: vi.fn(async ({ where, data: values }: { where: Row; data: Row }) => {
        const found = rows.filter((row) => matches(row as Row, where));
        for (const saved of found) data(saved, values);
        return { count: found.length };
      }),
    };
  }
  const database = {
    adBillingClick: collection(clicks, (value) => click(clicks.length + 1, value)),
    adChargeBatch: collection(batches, (value) =>
      batch({
        id: `batch-${batches.length + 1}`,
        status: 'PREPARED',
        txHash: null,
        signedTransaction: null,
        nonce: null,
        signerAddress: null,
        ...value,
      }),
    ),
    adChargeRun: collection(runs, (value) => run({ id: `run-${runs.length + 1}`, ...value })),
    adPricePublication: collection(publications, (value) => ({
      id: `publication-${publications.length + 1}`,
      ...identity,
      signerAddress: signer.address.toLowerCase(),
      nonce: 3n,
      status: 'SIGNED',
      ...value,
    })),
    adChargeSettings: {
      upsert: vi.fn(async () => ({ ...settings })),
      update: vi.fn(async ({ data: value }: { data: Row }) => data(settings, value)),
      findUniqueOrThrow: vi.fn(async () => ({ ...settings })),
    },
    preUsdPrice: { findFirst: vi.fn(async () => quote) },
    adIndexerState: {
      findUnique: vi.fn(async () =>
        quote
          ? {
              ...identity,
              lastBlockNumber: 80n,
              configBlockNumber: 80n,
              lastBlockHash: '0xblock',
              updatedAt: now,
              preUsdPriceE18Raw: BigInt(quote.priceUsd.mul('1e18').toFixed(0)).toString(),
              preUsdPriceQuotedAt: BigInt(Math.floor(quote.quotedAt.getTime() / 1_000)),
            }
          : null,
      ),
    },
    adChainEvent: { findFirst: vi.fn().mockResolvedValue(null) },
    $queryRaw: vi.fn(async () => []),
    $executeRaw: vi.fn(async (_query: Prisma.Sql) => 1),
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => {
      const result = await callback(database);
      events.push('commit');
      return result;
    }),
  };
  const chain = {
    head: vi.fn(async () => 100n),
    blockHash: vi.fn(async () => '0xblock'),
    verify: vi.fn(async () => undefined),
    operator: vi.fn(async () => signer.address),
    balance: vi.fn(async () => 10n ** 18n),
    position: vi.fn(async () => ({ amount: 100n, positionVersion: 2n })),
    processed: vi.fn(async () => false),
    receipt: vi.fn<ChargeDependencies['chain']['receipt']>(async () => null),
    pendingNonce: vi.fn(async () => 3n),
    sign: vi.fn<ChargeDependencies['chain']['sign']>(async () => ({
      raw: '0x1234',
      hash: '0xhash',
    })),
    broadcast: vi.fn(async () => {
      events.push('broadcast');
      return '0xhash';
    }),
  };
  const deps: ChargeDependencies = {
    chain,
    unlock: vi.fn(async () => signer),
    now,
    ...identity,
    confirmations: 12,
  };
  return {
    clicks,
    batches,
    runs,
    publications,
    settings,
    database,
    chain,
    deps,
    events,
    execute: (runId?: string) => processAdChargeJob(database as never, { runId }, deps),
    quote: (price = '0.01', quotedAt = now) => {
      quote = {
        id: 'quote-1',
        source: 'COINGECKO',
        assetId: 'presearch',
        priceUsd: new Prisma.Decimal(price),
        quotedAt,
        fetchedAt: now,
      };
    },
  };
}

describe('operator wallet refresh cadence', () => {
  it('reads the balance every ten minutes with automation off while keeping fifteen-second heartbeats', async () => {
    const f = fixture();
    f.settings.intervalMinutes = 1;
    await f.execute();
    f.chain.balance.mockResolvedValue(2n * 10n ** 18n);
    f.deps.now = new Date(now.getTime() + 15_000);
    await f.execute();
    expect(f.settings).toMatchObject({
      workerHeartbeatAt: f.deps.now,
      gasBalanceRaw: (10n ** 18n).toString(),
      readiness: 'READY',
    });
    expect(f.chain.head).toHaveBeenCalledTimes(2);
    expect(f.chain.verify).toHaveBeenCalledTimes(2);
    expect(f.chain.balance).toHaveBeenCalledOnce();
    f.deps.now = new Date(now.getTime() + 10 * 60_000 - 1);
    await f.execute();
    expect(f.chain.balance).toHaveBeenCalledOnce();
    f.deps.now = new Date(now.getTime() + 10 * 60_000);
    await f.execute();
    expect(f.chain.balance).toHaveBeenCalledTimes(2);
    expect(f.settings.gasBalanceRaw).toBe((2n * 10n ** 18n).toString());
    expect(f.chain.broadcast).not.toHaveBeenCalled();
  });

  it('applies the current automatic interval to the last balance read when settings change', async () => {
    const f = fixture();
    f.settings.automaticEnabled = true;
    f.settings.intervalMinutes = 5;
    await f.execute();
    f.deps.now = new Date(now.getTime() + 4 * 60_000);
    await f.execute();
    expect(f.chain.balance).toHaveBeenCalledOnce();
    f.settings.intervalMinutes = 2;
    await f.execute();
    expect(f.chain.balance).toHaveBeenCalledTimes(2);
    f.deps.now = new Date(now.getTime() + 6 * 60_000 - 1);
    await f.execute();
    expect(f.chain.balance).toHaveBeenCalledTimes(2);
    f.deps.now = new Date(now.getTime() + 6 * 60_000);
    await f.execute();
    expect(f.chain.balance).toHaveBeenCalledTimes(3);
    f.settings.intervalMinutes = 10;
    f.deps.now = new Date(now.getTime() + 8 * 60_000);
    await f.execute();
    expect(f.chain.balance).toHaveBeenCalledTimes(3);
  });

  it('keeps independent chains and different signing wallets from sharing a balance', async () => {
    const first = fixture();
    const second = fixture();
    second.chain.balance.mockResolvedValue(2n * 10n ** 18n);
    await first.execute();
    await second.execute();
    expect(first.chain.balance).toHaveBeenCalledOnce();
    expect(second.chain.balance).toHaveBeenCalledOnce();
    expect(second.settings.gasBalanceRaw).toBe((2n * 10n ** 18n).toString());
    const newSigner = privateKeyToAccount(`0x${'22'.repeat(32)}`);
    first.deps.unlock = vi.fn(async () => newSigner);
    first.chain.operator.mockResolvedValue(newSigner.address);
    first.chain.balance.mockResolvedValue(3n * 10n ** 18n);
    first.deps.now = new Date(now.getTime() + 15_000);
    await first.execute();
    expect(first.chain.balance).toHaveBeenLastCalledWith(newSigner.address);
    expect(first.chain.balance).toHaveBeenCalledTimes(2);
    expect(first.settings).toMatchObject({
      signerAddress: newSigner.address.toLowerCase(),
      gasBalanceRaw: (3n * 10n ** 18n).toString(),
    });
  });

  it('recovers a funded wallet on the next automatic pass before the daily balance refresh', async () => {
    const f = fixture();
    f.settings.automaticEnabled = true;
    f.settings.intervalMinutes = 1440;
    f.chain.balance.mockResolvedValue(0n);
    await expect(f.execute()).resolves.toMatchObject({
      outcome: 'BLOCKED',
      errorCode: 'INSUFFICIENT_GAS',
    });
    f.chain.balance.mockResolvedValue(10n ** 18n);
    f.deps.now = new Date(now.getTime() + 15_000);
    f.clicks.push(
      ...Array.from({ length: 50 }, (_, index) => click(index + 1, { clickedAt: f.deps.now })),
    );
    await expect(f.execute()).resolves.toMatchObject({ outcome: 'WAITING_CONFIRMATION' });
    expect(f.chain.balance).toHaveBeenCalledTimes(2);
    expect(f.settings.gasBalanceRaw).toBe((10n ** 18n).toString());
    expect(f.runs).toHaveLength(1);
    expect(f.runs[0]!.trigger).toBe('AUTO');
    expect(f.chain.sign).toHaveBeenCalledOnce();
    expect(f.chain.broadcast).toHaveBeenCalledOnce();
    expect(f.batches[0]).toMatchObject({ status: 'SUBMITTED', clickCount: 50 });
  });

  it('refreshes a cached positive balance for an explicit manual job', async () => {
    const f = fixture();
    await f.execute();
    f.chain.balance.mockResolvedValue(2n * 10n ** 18n);
    f.deps.now = new Date(now.getTime() + 15_000);
    f.clicks.push(click(1, { clickedAt: f.deps.now }));
    f.runs.push(run());
    await f.execute('run-1');
    expect(f.chain.balance).toHaveBeenCalledTimes(2);
    expect(f.settings.gasBalanceRaw).toBe((2n * 10n ** 18n).toString());
    expect(f.chain.sign).toHaveBeenCalledOnce();
    expect(f.batches[0]!.status).toBe('SUBMITTED');
  });

  it('keeps checking transaction fee sufficiency even when the display balance is cached', async () => {
    const f = fixture();
    f.settings.automaticEnabled = true;
    f.settings.clickThreshold = 1;
    await f.execute();
    f.deps.now = new Date(now.getTime() + 15_000);
    f.clicks.push(click(1, { clickedAt: f.deps.now }));
    f.chain.sign.mockRejectedValue(new ChargeBlocked('INSUFFICIENT_GAS'));
    await f.execute();
    expect(f.chain.balance).toHaveBeenCalledOnce();
    expect(f.chain.sign).toHaveBeenCalledOnce();
    expect(f.settings.errorCode).toBe('INSUFFICIENT_GAS');
    expect(f.chain.broadcast).not.toHaveBeenCalled();
  });
});

describe('charge debt and scheduling', () => {
  it('keeps automatic charging disabled by default while updating readiness and interrupted captures', async () => {
    const f = fixture();
    f.clicks.push(click(), click(2, { status: 'CAPTURING', amountPreRaw: null }));
    await f.execute();
    expect(f.runs).toHaveLength(0);
    expect(f.clicks[0]!.status).toBe('PENDING');
    expect(f.clicks[1]).toMatchObject({ status: 'UNBILLED', errorCode: 'CAPTURE_INTERRUPTED' });
    expect(f.chain.broadcast).not.toHaveBeenCalled();
    expect(f.settings).toMatchObject({
      readiness: 'READY',
      workerHeartbeatAt: now,
      signerAddress: signer.address.toLowerCase(),
    });
  });

  it('freezes USD debt once using the last indexed contract quote, including stale quotes with automatic settlement off', async () => {
    const f = fixture();
    f.clicks.push(click(1, { status: 'PRICE_PENDING', amountPreRaw: null }));
    f.quote('0.01', new Date(now.getTime() - 31 * 60_000));
    await f.execute();
    expect(f.clicks[0]).toMatchObject({
      status: 'PENDING',
      amountPreRaw: '10000000000000000000',
      priceQuoteId: null,
      priceUsd: '0.01',
    });
    f.quote('0.02');
    await f.execute();
    expect(f.clicks[0]!.amountPreRaw).toBe('10000000000000000000');
    expect(f.chain.broadcast).not.toHaveBeenCalled();
  });

  it('uses either the first pending click age or click count with current configurable values', () => {
    const settings = { intervalMinutes: 10, clickThreshold: 50 };
    expect(chargeGroupDue([], settings, now)).toBe(false);
    expect(chargeGroupDue([click()], settings, now)).toBe(true);
    const recent = click(1, { clickedAt: new Date(now.getTime() - 9 * 60_000) });
    expect(chargeGroupDue([recent], settings, now)).toBe(false);
    expect(
      chargeGroupDue(
        Array.from({ length: 50 }, () => recent),
        settings,
        now,
      ),
    ).toBe(true);
    expect(chargeGroupDue([recent], { intervalMinutes: 5, clickThreshold: 10 }, now)).toBe(true);
  });

  it('creates an automatic run only when a deployment group reaches its threshold', async () => {
    const f = fixture();
    f.settings.automaticEnabled = true;
    f.clicks.push(click(1, { clickedAt: now }));
    await f.execute();
    expect(f.runs).toHaveLength(0);
    f.settings.clickThreshold = 1;
    await f.execute();
    expect(f.runs[0]).toMatchObject({ trigger: 'AUTO', status: 'RUNNING' });
    expect(f.batches[0]).toMatchObject({ clickCount: 1, duePreRaw: '10', requestedPreRaw: '10' });
  });

  it('manual charging bypasses both thresholds and commits the signed transaction before broadcast', async () => {
    const f = fixture();
    f.clicks.push(click(1, { clickedAt: now }));
    f.runs.push(run());
    await f.execute('run-1');
    expect(f.batches[0]).toMatchObject({
      status: 'SUBMITTED',
      nonce: 3n,
      signedTransaction: '0x1234',
      txHash: '0xhash',
    });
    expect(f.clicks[0]).toMatchObject({ status: 'RESERVED', batchId: 'batch-1' });
    expect(f.events.slice(-3)).toEqual(['persist-signature', 'commit', 'broadcast']);
    expect(f.database.$executeRaw).toHaveBeenCalledTimes(2);
    expect(f.database.$executeRaw.mock.calls[1]![0].values).toEqual([
      `keyword-market-wallet:${identity.chainId}:${signer.address.toLowerCase()}`,
    ]);
    expect(f.settings.readiness).toBe('WAITING_CONFIRMATION');
  });

  it.each(['SIGNED', 'SUBMITTED', 'RECONCILING'])(
    'does not sign a charge while the operator has a %s price publication',
    async (status) => {
      const f = fixture();
      f.clicks.push(click());
      f.runs.push(run());
      f.publications.push({
        id: 'old-updater-publication',
        ...identity,
        contractAddress: `0x${'aa'.repeat(20)}`,
        signerAddress: signer.address.toLowerCase(),
        nonce: 3n,
        status,
      });
      await f.execute('run-1');
      expect(f.chain.sign).not.toHaveBeenCalled();
      expect(f.chain.broadcast).not.toHaveBeenCalled();
      expect(f.batches[0]).toMatchObject({
        status: 'PREPARED',
        errorCode: 'WAITING_CONFIRMATION',
        nonce: null,
      });
      expect(f.publications[0]).toMatchObject({ status, nonce: 3n });
    },
  );

  it.each(['CONFIRMED', 'FAILED', 'SUPERSEDED'])(
    'does not reuse the saved nonce of a %s price publication after the RPC loses it',
    async (status) => {
      const f = fixture();
      f.clicks.push(click());
      f.runs.push(run());
      f.publications.push({
        id: 'old-updater-publication',
        ...identity,
        signerAddress: signer.address.toLowerCase(),
        nonce: 3n,
        status,
      });
      await f.execute('run-1');
      expect(f.chain.sign).not.toHaveBeenCalled();
      expect(f.chain.broadcast).not.toHaveBeenCalled();
      expect(f.batches[0]!.errorCode).toBe('NONCE_GAP');
    },
  );

  it('signs a charge after the former updater publication nonce has been consumed', async () => {
    const f = fixture();
    f.clicks.push(click());
    f.runs.push(run());
    f.publications.push({
      id: 'old-updater-publication',
      ...identity,
      signerAddress: signer.address.toLowerCase(),
      nonce: 3n,
      status: 'CONFIRMED',
    });
    f.chain.pendingNonce.mockResolvedValue(4n);
    await f.execute('run-1');
    expect(f.chain.sign.mock.calls[0]![2]).toBe(4n);
    expect(f.batches[0]).toMatchObject({ status: 'SUBMITTED', nonce: 4n });
  });

  it('does not reserve new clicks repeatedly when a manual run is waiting for confirmation', async () => {
    const f = fixture();
    f.clicks.push(click());
    f.runs.push(run());
    await f.execute('run-1');
    const originalCharge = f.batches[0]!.chargeId;
    f.clicks.push(click(2, { clickedAt: new Date(now.getTime() + 1) }));
    await f.execute('run-1');
    expect(f.batches).toHaveLength(1);
    expect(f.batches[0]!.chargeId).toBe(originalCharge);
    expect(f.clicks[1]!.status).toBe('PENDING');
    expect(f.chain.sign).toHaveBeenCalledOnce();
  });

  it('blocks an unavailable operator without exposing provider or keystore error text', async () => {
    const f = fixture();
    f.runs.push(run());
    f.deps.unlock = vi.fn().mockRejectedValue(new ChargeBlocked('KEYSTORE_INVALID'));
    await expect(f.execute()).resolves.toEqual({
      outcome: 'BLOCKED',
      errorCode: 'KEYSTORE_INVALID',
    });
    expect(f.runs[0]).toMatchObject({ status: 'BLOCKED', errorCode: 'KEYSTORE_INVALID' });
    expect(f.chain.sign).not.toHaveBeenCalled();
    f.deps.unlock = vi.fn().mockRejectedValue(new Error('password rpc-secret-key'));
    await expect(f.execute()).resolves.toEqual({
      outcome: 'BLOCKED',
      errorCode: 'RPC_UNAVAILABLE',
    });
    expect(Object.values(f.settings).map(String).join(',')).not.toContain('rpc-secret-key');
  });

  it('rejects mismatched operators and zero gas balances', async () => {
    const f = fixture();
    f.runs.push(run());
    f.chain.operator.mockResolvedValue(`0x${'00'.repeat(20)}`);
    await f.execute();
    expect(f.settings.errorCode).toBe('OPERATOR_MISMATCH');
    f.chain.operator.mockResolvedValue(signer.address);
    f.chain.balance.mockResolvedValue(0n);
    await f.execute();
    expect(f.settings.errorCode).toBe('INSUFFICIENT_GAS');
    expect(f.chain.broadcast).not.toHaveBeenCalled();
  });

  it('keeps a manual run blocked until its preexisting USD debt gets an indexed contract quote', async () => {
    const f = fixture();
    f.runs.push(run());
    f.clicks.push(click(1, { status: 'PRICE_PENDING', amountPreRaw: null }));
    await f.execute('run-1');
    expect(f.runs[0]).toMatchObject({
      status: 'BLOCKED',
      errorCode: 'PRICE_UNAVAILABLE',
      startedAt: now,
    });
    expect(f.settings.readiness).toBe('READY');
    expect(f.batches).toHaveLength(0);
    f.quote();
    await f.execute('run-1');
    expect(f.batches[0]).toMatchObject({
      status: 'SUBMITTED',
      clickCount: 1,
      duePreRaw: '10000000000000000000',
    });
    expect(f.runs[0]!.status).toBe('RUNNING');
    expect(f.clicks[0]!.status).toBe('RESERVED');
  });

  it('charges frozen PRE while keeping USD debt in the same manual run recoverable', async () => {
    const f = fixture();
    f.runs.push(run());
    f.clicks.push(click(), click(2, { status: 'PRICE_PENDING', amountPreRaw: null }));
    await f.execute('run-1');
    const firstBatch = f.batches[0]!;
    expect(f.runs[0]).toMatchObject({ status: 'BLOCKED', errorCode: 'PRICE_UNAVAILABLE' });
    f.chain.receipt.mockResolvedValue(
      receipt({
        event: {
          chargeId: firstBatch.chargeId,
          keywordId,
          staker: signer.address,
          requestedPre: 10n,
          chargedPre: 10n,
        },
      }),
    );
    await f.execute();
    expect(f.clicks[0]!.status).toBe('SETTLED');
    expect(f.runs[0]!.status).toBe('BLOCKED');
    f.chain.receipt.mockImplementation(async (hash) =>
      hash === firstBatch.txHash
        ? receipt({
            event: {
              chargeId: firstBatch.chargeId,
              keywordId,
              staker: signer.address,
              requestedPre: 10n,
              chargedPre: 10n,
            },
          })
        : null,
    );
    f.chain.sign.mockResolvedValue({ raw: '0x5678', hash: '0xotherhash' });
    f.chain.broadcast.mockResolvedValue('0xotherhash');
    f.chain.pendingNonce.mockResolvedValue(4n);
    f.quote();
    await f.execute();
    expect(f.batches).toHaveLength(2);
    expect(f.batches[1]).toMatchObject({ runId: 'run-1', clickCount: 1, status: 'SUBMITTED' });
    expect(f.clicks.map((row) => row.status)).toEqual(['SETTLED', 'RESERVED']);
  });

  it('waits until a click source block is finalized before signing', async () => {
    const f = fixture();
    f.runs.push(run());
    f.clicks.push(click(1, { bidBlockNumber: 99n }));
    await f.execute('run-1');
    expect(f.batches).toHaveLength(0);
    expect(f.runs[0]!.status).toBe('RUNNING');
    f.chain.head.mockResolvedValue(111n);
    await f.execute('run-1');
    expect(f.batches[0]!.status).toBe('SUBMITTED');
  });

  it('invalidates an orphaned bid capture without substituting any newer bid', async () => {
    const f = fixture();
    f.runs.push(run());
    f.clicks.push(click(1, { bidBlockHash: '0xorphan' }));
    await f.execute('run-1');
    expect(f.clicks[0]).toMatchObject({
      status: 'UNBILLED',
      bidUsdRaw: '100000',
      amountPreRaw: '10',
      errorCode: 'REORG_DETECTED',
    });
    expect(f.batches).toHaveLength(0);
    expect(f.chain.sign).not.toHaveBeenCalled();
  });

  it('blocks an orphaned price proof independently of the still-canonical bid proof', async () => {
    const f = fixture();
    f.runs.push(run());
    f.clicks.push(click(1, { priceBlockNumber: 81n, priceBlockHash: '0xorphan' }));
    await f.execute('run-1');
    expect(f.clicks[0]).toMatchObject({
      status: 'UNBILLED',
      errorCode: 'REORG_DETECTED',
      amountPreRaw: '10',
    });
    expect(f.chain.sign).not.toHaveBeenCalled();
    expect(f.chain.broadcast).not.toHaveBeenCalled();
  });

  it('waits for the price source block even when the bid source is already finalized', async () => {
    const f = fixture();
    f.runs.push(run());
    f.clicks.push(click(1, { priceBlockNumber: 99n, priceBlockHash: '0xblock' }));
    await f.execute('run-1');
    expect(f.chain.sign).not.toHaveBeenCalled();
    f.chain.head.mockResolvedValue(111n);
    await f.execute('run-1');
    expect(f.chain.sign).toHaveBeenCalledOnce();
  });

  it('caps the transaction request at uint256 while retaining the complete debt', async () => {
    const f = fixture();
    f.runs.push(run());
    const max = (1n << 256n) - 1n;
    f.clicks.push(click(1, { amountPreRaw: max.toString() }), click(2));
    await f.execute('run-1');
    expect(f.batches[0]).toMatchObject({
      duePreRaw: (max + 10n).toString(),
      requestedPreRaw: max.toString(),
    });
  });

  it('allows a manual charge to resume an unsigned automatic batch after disabling automation', async () => {
    const f = fixture();
    f.runs.push(run({ id: 'auto-run', trigger: 'AUTO', status: 'RUNNING', startedAt: now }), run());
    f.batches.push(
      batch({
        runId: 'auto-run',
        status: 'PREPARED',
        txHash: null,
        signedTransaction: null,
        signerAddress: null,
        nonce: null,
      }),
    );
    f.clicks.push(click(1, { batchId: 'batch-1', status: 'RESERVED' }));
    await f.execute('run-1');
    expect(f.batches).toHaveLength(1);
    expect(f.batches[0]).toMatchObject({
      id: 'batch-1',
      chargeId,
      runId: 'run-1',
      status: 'SUBMITTED',
    });
    expect(f.runs.find((row) => row.id === 'auto-run')!.status).toBe('COMPLETED');
    expect(f.chain.sign).toHaveBeenCalledOnce();
  });

  it('blocks an orphaned capture in a previously prepared batch without signing altered debt', async () => {
    const f = fixture();
    f.runs.push(run({ status: 'RUNNING', startedAt: now }));
    f.batches.push(
      batch({
        status: 'PREPARED',
        txHash: null,
        signedTransaction: null,
        nonce: null,
        signerAddress: null,
      }),
    );
    f.clicks.push(click(1, { batchId: 'batch-1', status: 'RESERVED', bidBlockHash: '0xorphan' }));
    await f.execute();
    expect(f.batches[0]).toMatchObject({
      chargeId,
      status: 'PREPARED',
      duePreRaw: '10',
      errorCode: 'CAPTURE_PROOF_ORPHANED',
    });
    expect(f.settings.readiness).toBe('READY');
    expect(f.runs[0]).toMatchObject({ status: 'BLOCKED', errorCode: 'CAPTURE_PROOF_ORPHANED' });
    expect(f.chain.sign).not.toHaveBeenCalled();
  });

  it('continues charging other groups while a single prepared batch has orphaned capture proof', async () => {
    const f = fixture();
    f.runs.push(run({ status: 'RUNNING', startedAt: now }));
    f.batches.push(
      batch({
        status: 'PREPARED',
        txHash: null,
        signedTransaction: null,
        nonce: null,
        signerAddress: null,
      }),
    );
    f.clicks.push(
      click(1, { batchId: 'batch-1', status: 'RESERVED', bidBlockHash: '0xorphan' }),
      click(2, { keywordId: `0x${'00'.repeat(32)}` }),
    );
    await f.execute();
    expect(f.batches[0]).toMatchObject({ status: 'PREPARED', errorCode: 'CAPTURE_PROOF_ORPHANED' });
    expect(f.batches[1]).toMatchObject({ status: 'SUBMITTED', keywordId: `0x${'00'.repeat(32)}` });
    expect(f.chain.sign).toHaveBeenCalledOnce();
    expect(f.settings.readiness).toBe('WAITING_CONFIRMATION');
  });
});

describe('durable transactions and stake lifetimes', () => {
  it('replays exactly the saved bytes after an RPC timeout or a crash after signing', async () => {
    const f = fixture();
    f.runs.push(run());
    f.clicks.push(click());
    f.chain.broadcast.mockRejectedValueOnce(new Error('rpc-url password nonce failure'));
    await f.execute('run-1');
    const saved = {
      chargeId: f.batches[0]!.chargeId,
      txHash: f.batches[0]!.txHash,
      nonce: f.batches[0]!.nonce,
    };
    expect(f.batches[0]).toMatchObject({
      ...saved,
      status: 'RECONCILING',
      errorCode: 'TRANSACTION_UNKNOWN',
    });
    await f.execute('run-1');
    expect(f.batches[0]).toMatchObject({ ...saved, status: 'SUBMITTED' });
    expect(f.chain.sign).toHaveBeenCalledOnce();
    expect(f.chain.broadcast.mock.calls).toEqual([['0x1234'], ['0x1234']]);
  });
  it('preserves a signed charge and reports a known gas shortage at broadcast', async () => {
    const f = fixture();
    f.runs.push(run());
    f.clicks.push(click());
    f.chain.broadcast.mockRejectedValue(new ChargeBlocked('INSUFFICIENT_GAS'));
    await f.execute('run-1');
    expect(f.batches[0]).toMatchObject({
      status: 'RECONCILING',
      errorCode: 'INSUFFICIENT_GAS',
      signedTransaction: '0x1234',
      txHash: '0xhash',
      nonce: 3n,
    });
    expect(f.settings).toMatchObject({ readiness: 'BLOCKED', errorCode: 'INSUFFICIENT_GAS' });
    expect(f.clicks[0]).toMatchObject({ status: 'RESERVED', amountPreRaw: '10' });
    expect(f.chain.sign).toHaveBeenCalledOnce();
  });

  it('waits for confirmations and verifies the matching event before settling debt', async () => {
    const f = fixture();
    f.batches.push(batch());
    f.runs.push(run({ status: 'RUNNING', startedAt: now }));
    f.clicks.push(click(1, { batchId: 'batch-1', status: 'RESERVED' }));
    f.chain.receipt.mockResolvedValue(receipt({ blockNumber: 95n }));
    await f.execute();
    expect(f.batches[0]!.status).toBe('RECONCILING');
    expect(f.clicks[0]!.status).toBe('RESERVED');
    f.chain.head.mockResolvedValue(107n);
    await f.execute();
    expect(f.batches[0]).toMatchObject({
      status: 'CONFIRMED',
      chargedPreRaw: '10',
      shortfallPreRaw: '0',
    });
    expect(f.clicks[0]!.status).toBe('SETTLED');
    expect(f.runs[0]!.status).toBe('COMPLETED');
    expect(f.chain.broadcast).not.toHaveBeenCalled();
  });

  it('records actual partial collection and makes the remaining original debt uncollectable', async () => {
    const f = fixture();
    f.batches.push(batch({ clickCount: 2, duePreRaw: '20', requestedPreRaw: '20' }));
    f.runs.push(run({ status: 'RUNNING', startedAt: now }));
    f.clicks.push(
      click(1, { batchId: 'batch-1', status: 'RESERVED' }),
      click(2, { batchId: 'batch-1', status: 'RESERVED' }),
    );
    f.chain.receipt.mockResolvedValue(
      receipt({
        event: { chargeId, keywordId, staker: signer.address, requestedPre: 20n, chargedPre: 12n },
      }),
    );
    await f.execute();
    expect(f.batches[0]).toMatchObject({
      status: 'PARTIAL',
      chargedPreRaw: '12',
      shortfallPreRaw: '8',
      errorCode: 'INSUFFICIENT_STAKE',
    });
    expect(f.clicks.map((row) => row.status)).toEqual(['SETTLED', 'UNCOLLECTABLE']);
    expect(f.runs[0]!.status).toBe('PARTIAL');
  });

  it('never charges an old stake debt against a confirmed reopened position', async () => {
    const f = fixture();
    f.clicks.push(click());
    f.runs.push(run());
    f.chain.position.mockResolvedValue({ amount: 100n, positionVersion: 3n });
    await f.execute('run-1');
    expect(f.batches[0]).toMatchObject({
      status: 'UNCOLLECTABLE',
      shortfallPreRaw: '10',
      errorCode: 'POSITION_VERSION_MISMATCH',
    });
    expect(f.clicks[0]!.status).toBe('UNCOLLECTABLE');
    expect(f.chain.sign).not.toHaveBeenCalled();
  });

  it('waits for a new version to finalize before marking original debt uncollectable', async () => {
    const f = fixture();
    f.clicks.push(click());
    f.runs.push(run());
    f.chain.position
      .mockResolvedValueOnce({ amount: 100n, positionVersion: 2n })
      .mockResolvedValueOnce({ amount: 100n, positionVersion: 3n });
    await f.execute('run-1');
    expect(f.batches[0]).toMatchObject({ status: 'PREPARED', errorCode: 'WAITING_CONFIRMATION' });
    expect(f.clicks[0]!.status).toBe('RESERVED');
    expect(f.chain.sign).not.toHaveBeenCalled();
  });

  it('reconciles a saved transaction with automation off and an unavailable keystore', async () => {
    const f = fixture();
    f.batches.push(batch());
    f.runs.push(run({ status: 'RUNNING', trigger: 'AUTO', startedAt: now }));
    f.clicks.push(click(1, { batchId: 'batch-1', status: 'RESERVED' }));
    f.deps.unlock = vi.fn().mockRejectedValue(new ChargeBlocked('KEYSTORE_MISSING'));
    f.chain.receipt.mockResolvedValue(receipt());
    await f.execute();
    expect(f.clicks[0]!.status).toBe('SETTLED');
    expect(f.runs[0]!.status).toBe('COMPLETED');
    expect(f.chain.sign).not.toHaveBeenCalled();
  });

  it('never sends another transaction when chargeProcessed is true but its receipt is unavailable', async () => {
    const f = fixture();
    f.batches.push(batch());
    f.runs.push(run({ status: 'RUNNING', startedAt: now }));
    f.chain.processed.mockResolvedValue(true);
    await f.execute();
    expect(f.batches[0]).toMatchObject({ status: 'RECONCILING', errorCode: 'TRANSACTION_UNKNOWN' });
    expect(f.chain.broadcast).not.toHaveBeenCalled();
    expect(f.chain.sign).not.toHaveBeenCalled();
  });

  it('recovers the actual charge event from the finalized index when a replay succeeds without a new event', async () => {
    const f = fixture();
    f.batches.push(batch());
    f.runs.push(run({ status: 'RUNNING', startedAt: now }));
    f.clicks.push(click(1, { batchId: 'batch-1', status: 'RESERVED' }));
    f.chain.receipt.mockResolvedValue(receipt({ event: null }));
    f.database.adChainEvent.findFirst.mockResolvedValue(indexedCharge());
    await f.execute();
    expect(f.batches[0]).toMatchObject({
      status: 'CONFIRMED',
      txHash: '0xhash',
      signedTransaction: '0x1234',
      settledTxHash: '0xoriginal-success',
      chargedPreRaw: '10',
    });
    expect(f.clicks[0]!.status).toBe('SETTLED');
    expect(f.database.adChainEvent.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ payload: { path: ['chargeId'], equals: chargeId } }),
      }),
    );
    expect(f.chain.broadcast).not.toHaveBeenCalled();
  });

  it('resolves an already processed charge with a different transaction hash using canonical indexed proof', async () => {
    const f = fixture();
    f.batches.push(batch());
    f.runs.push(run({ status: 'RUNNING', startedAt: now }));
    f.chain.processed.mockResolvedValue(true);
    f.database.adChainEvent.findFirst.mockResolvedValue(indexedCharge());
    await f.execute();
    expect(f.batches[0]).toMatchObject({
      status: 'CONFIRMED',
      settledTxHash: '0xoriginal-success',
      txHash: '0xhash',
      nonce: 3n,
    });
    expect(f.chain.broadcast).not.toHaveBeenCalled();
  });

  it('does not skip an unaccepted retry nonce after settling the original charge event', async () => {
    const f = fixture();
    f.batches.push(batch({ nonce: 4n, attemptCount: 2 }));
    f.runs.push(run({ status: 'RUNNING', startedAt: now }));
    f.chain.processed.mockResolvedValue(true);
    f.database.adChainEvent.findFirst.mockResolvedValue(indexedCharge());
    await f.execute();
    expect(f.batches[0]).toMatchObject({
      status: 'CONFIRMED',
      nonce: 4n,
      settledTxHash: '0xoriginal-success',
    });
    f.chain.processed.mockResolvedValue(false);
    f.chain.pendingNonce.mockResolvedValue(4n);
    f.runs.push(run({ id: 'run-2' }));
    f.clicks.push(click());
    await f.execute('run-2');
    expect(f.batches[1]).toMatchObject({ status: 'PREPARED', errorCode: 'NONCE_GAP' });
    expect(f.chain.sign).not.toHaveBeenCalled();
    expect(f.chain.broadcast).not.toHaveBeenCalled();
  });

  it('waits for canonical indexed proof instead of trusting an orphaned acknowledgement', async () => {
    const f = fixture();
    f.batches.push(batch());
    f.runs.push(run({ status: 'RUNNING', startedAt: now }));
    f.chain.processed.mockResolvedValue(true);
    f.database.adChainEvent.findFirst.mockResolvedValue({
      ...indexedCharge(),
      blockHash: '0xorphan',
    });
    await f.execute();
    expect(f.batches[0]).toMatchObject({
      status: 'RECONCILING',
      errorCode: 'TRANSACTION_UNKNOWN',
      settledTxHash: null,
    });
    expect(f.chain.broadcast).not.toHaveBeenCalled();
  });

  it('rejects indexed acknowledgement with a different requested amount', async () => {
    const f = fixture();
    f.batches.push(batch());
    f.runs.push(run({ status: 'RUNNING', startedAt: now }));
    f.chain.processed.mockResolvedValue(true);
    const indexed = indexedCharge();
    indexed.payload.requestedPre = '11';
    f.database.adChainEvent.findFirst.mockResolvedValue(indexed);
    await f.execute();
    expect(f.settings.errorCode).toBe('TRANSACTION_UNKNOWN');
    expect(f.batches[0]!.chargedPreRaw).toBeNull();
    expect(f.chain.broadcast).not.toHaveBeenCalled();
  });

  it('preserves the batch, charge ID, amounts and signed bytes after a reorganization', async () => {
    const f = fixture();
    f.batches.push(
      batch({
        status: 'CONFIRMED',
        chargedPreRaw: '10',
        shortfallPreRaw: '0',
        receiptBlockNumber: 80n,
        receiptBlockHash: '0xorphan',
      }),
    );
    f.runs.push(run({ status: 'COMPLETED', startedAt: now, finishedAt: now }));
    f.clicks.push(click(1, { batchId: 'batch-1', status: 'SETTLED' }));
    await f.execute();
    expect(f.batches[0]).toMatchObject({
      chargeId,
      requestedPreRaw: '10',
      duePreRaw: '10',
      signedTransaction: '0x1234',
      status: 'SUBMITTED',
      chargedPreRaw: null,
    });
    expect(f.clicks[0]).toMatchObject({
      amountPreRaw: '10',
      batchId: 'batch-1',
      status: 'RESERVED',
    });
    expect(f.runs[0]).toMatchObject({ status: 'RUNNING', finishedAt: null });
    expect(f.chain.sign).not.toHaveBeenCalled();
    expect(f.chain.broadcast).toHaveBeenCalledWith('0x1234');
  });

  it('refuses to replay a signed charge when a deep reorganization also orphaned its captured bid', async () => {
    const f = fixture();
    f.batches.push(
      batch({
        status: 'CONFIRMED',
        chargedPreRaw: '10',
        shortfallPreRaw: '0',
        receiptBlockNumber: 80n,
        receiptBlockHash: '0xorphan',
      }),
    );
    f.runs.push(run({ status: 'COMPLETED', startedAt: now, finishedAt: now }));
    f.clicks.push(
      click(1, { batchId: 'batch-1', status: 'SETTLED', bidBlockHash: '0xold-capture' }),
    );
    await f.execute();
    expect(f.batches[0]).toMatchObject({
      chargeId,
      requestedPreRaw: '10',
      status: 'RECONCILING',
      errorCode: 'CAPTURE_PROOF_ORPHANED',
    });
    expect(f.clicks[0]).toMatchObject({ status: 'RESERVED', amountPreRaw: '10' });
    expect(f.settings).toMatchObject({ readiness: 'BLOCKED', errorCode: 'CAPTURE_PROOF_ORPHANED' });
    expect(f.chain.broadcast).not.toHaveBeenCalled();
    expect(f.chain.sign).not.toHaveBeenCalled();
  });

  it('serializes signing against another market using the same operator and chain', async () => {
    const f = fixture();
    f.clicks.push(click());
    f.runs.push(run());
    f.batches.push(batch({ id: 'other-market', contractAddress: `0x${'aa'.repeat(20)}` }));
    await f.execute('run-1');
    expect(f.chain.sign).not.toHaveBeenCalled();
    expect(f.batches.find((row) => row.id !== 'other-market')).toMatchObject({
      status: 'PREPARED',
      errorCode: 'WAITING_CONFIRMATION',
    });
  });

  it('does not create more nonce gaps after a previous durable nonce disappears from the RPC', async () => {
    const f = fixture();
    f.clicks.push(click());
    f.runs.push(run());
    f.batches.push(
      batch({
        id: 'older-charge',
        contractAddress: `0x${'aa'.repeat(20)}`,
        status: 'CONFIRMED',
        nonce: 8n,
      }),
    );
    await f.execute('run-1');
    expect(f.chain.sign).not.toHaveBeenCalled();
    expect(f.batches.find((row) => row.id !== 'older-charge')!.errorCode).toBe('NONCE_GAP');
  });

  it('refuses an event whose keyword, wallet, amount or charge ID differs from the saved batch', async () => {
    const f = fixture();
    f.chain.receipt.mockResolvedValue(
      receipt({
        event: { chargeId, keywordId, staker: signer.address, requestedPre: 11n, chargedPre: 10n },
      }),
    );
    await expect(
      reconcileChargeBatch(f.database as never, batch(), f.deps, 100n),
    ).rejects.toMatchObject({ code: 'TRANSACTION_UNKNOWN' });
    expect(f.database.adBillingClick.updateMany).not.toHaveBeenCalled();
  });

  it('rechecks unsigned uncollectable debt after its finalized position evidence is reorganized', async () => {
    const f = fixture();
    f.runs.push(run({ status: 'PARTIAL', trigger: 'AUTO', startedAt: now, finishedAt: now }));
    f.batches.push(
      batch({
        status: 'UNCOLLECTABLE',
        txHash: null,
        signedTransaction: null,
        nonce: null,
        signerAddress: null,
        chargedPreRaw: '0',
        shortfallPreRaw: '10',
        receiptBlockNumber: 88n,
        receiptBlockHash: '0xorphan',
        errorCode: 'POSITION_VERSION_MISMATCH',
      }),
    );
    f.clicks.push(click(1, { batchId: 'batch-1', status: 'UNCOLLECTABLE' }));
    await f.execute();
    expect(f.batches[0]).toMatchObject({
      chargeId,
      status: 'PREPARED',
      chargedPreRaw: null,
      shortfallPreRaw: null,
      receiptBlockNumber: null,
    });
    expect(f.clicks[0]).toMatchObject({
      batchId: 'batch-1',
      amountPreRaw: '10',
      status: 'RESERVED',
    });
    expect(f.runs[0]).toMatchObject({ status: 'RUNNING', finishedAt: null });
    expect(f.chain.sign).not.toHaveBeenCalled();
  });

  it('retries a canonical reverted transaction using the same charge ID and amount after the retry delay', async () => {
    const f = fixture();
    f.runs.push(run({ status: 'RUNNING', startedAt: now }));
    f.batches.push(batch());
    f.clicks.push(click(1, { batchId: 'batch-1', status: 'RESERVED' }));
    f.chain.receipt.mockResolvedValue(receipt({ reverted: true, event: null }));
    await f.execute();
    expect(f.batches[0]).toMatchObject({
      status: 'FAILED',
      nextAttemptAt: new Date(now.getTime() + 60_000),
    });
    expect(f.chain.sign).not.toHaveBeenCalled();
    f.deps.now = new Date(now.getTime() + 60_001);
    f.chain.pendingNonce.mockResolvedValue(4n);
    f.chain.receipt.mockImplementation(async (hash) =>
      hash === '0xhash' ? receipt({ reverted: true, event: null }) : null,
    );
    f.chain.sign.mockResolvedValue({ raw: '0x5678', hash: '0xnewhash' });
    f.chain.broadcast.mockResolvedValue('0xnewhash');
    await f.execute();
    expect(f.batches[0]).toMatchObject({
      chargeId,
      duePreRaw: '10',
      requestedPreRaw: '10',
      status: 'SUBMITTED',
      nonce: 4n,
      txHash: '0xnewhash',
    });
    expect(f.chain.sign).toHaveBeenCalledOnce();
  });

  it('reports a missing predecessor after a retry and deep reorganization instead of looping on an unmineable transaction', async () => {
    const f = fixture();
    f.runs.push(run({ status: 'COMPLETED', startedAt: now, finishedAt: now }));
    f.batches.push(
      batch({
        nonce: 4n,
        status: 'CONFIRMED',
        chargedPreRaw: '10',
        shortfallPreRaw: '0',
        receiptBlockNumber: 80n,
        receiptBlockHash: '0xorphan',
        attemptCount: 2,
      }),
    );
    f.clicks.push(click(1, { batchId: 'batch-1', status: 'SETTLED' }));
    f.chain.pendingNonce.mockResolvedValue(3n);
    await f.execute();
    expect(f.batches[0]).toMatchObject({
      chargeId,
      nonce: 4n,
      status: 'RECONCILING',
      errorCode: 'NONCE_GAP',
    });
    expect(f.settings).toMatchObject({ readiness: 'BLOCKED', errorCode: 'NONCE_GAP' });
    expect(f.clicks[0]).toMatchObject({ status: 'RESERVED', amountPreRaw: '10' });
    expect(f.chain.broadcast).not.toHaveBeenCalled();
    expect(f.chain.sign).not.toHaveBeenCalled();
  });

  it('skips historical terminal receipt reads while the previous finalized checkpoint remains canonical', async () => {
    const f = fixture();
    f.settings.reconciliationBlockNumber = 88n;
    f.settings.reconciliationBlockHash = '0xblock';
    f.batches.push(
      batch({
        status: 'CONFIRMED',
        receiptBlockNumber: 80n,
        receiptBlockHash: '0xold-receipt',
        chargedPreRaw: '10',
        shortfallPreRaw: '0',
      }),
    );
    await f.execute();
    expect(f.chain.blockHash.mock.calls).toEqual([[88n], [88n]]);
    expect(f.chain.receipt).not.toHaveBeenCalled();
    expect(f.batches[0]!.status).toBe('CONFIRMED');
  });

  it('rescans old terminal receipts after a deep reorganization invalidates its prior checkpoint', async () => {
    const f = fixture();
    f.settings.reconciliationBlockNumber = 88n;
    f.settings.reconciliationBlockHash = '0xold-checkpoint';
    f.runs.push(run({ status: 'COMPLETED', startedAt: now, finishedAt: now }));
    f.batches.push(
      batch({
        status: 'CONFIRMED',
        receiptBlockNumber: 50n,
        receiptBlockHash: '0xorphan',
        chargedPreRaw: '10',
        shortfallPreRaw: '0',
      }),
    );
    f.clicks.push(click(1, { batchId: 'batch-1', status: 'SETTLED' }));
    await f.execute();
    expect(f.chain.blockHash).toHaveBeenCalledWith(50n);
    expect(f.batches[0]).toMatchObject({ chargeId, status: 'SUBMITTED', chargedPreRaw: null });
    expect(f.settings).toMatchObject({
      reconciliationBlockNumber: 88n,
      reconciliationBlockHash: '0xblock',
    });
  });

  it('retains the previous reconciliation checkpoint when receipt processing fails', async () => {
    const f = fixture();
    f.settings.reconciliationBlockNumber = 85n;
    f.settings.reconciliationBlockHash = '0xblock';
    f.batches.push(batch());
    f.chain.receipt.mockRejectedValue(new Error('private-rpc-token'));
    await f.execute();
    expect(f.settings).toMatchObject({
      reconciliationBlockNumber: 85n,
      reconciliationBlockHash: '0xblock',
      errorCode: 'RPC_UNAVAILABLE',
    });
  });
});
