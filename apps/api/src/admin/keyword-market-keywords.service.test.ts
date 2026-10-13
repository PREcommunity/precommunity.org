import { Prisma } from '@precommunity/database';
import { adKeywordId } from '@precommunity/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KeywordMarketKeywordsService } from './keyword-market-keywords.service';

const runtime = vi.hoisted(() => ({
  deployment: { chainId: 8453 },
  adsContract: { address: `0x${'AB'.repeat(20)}` as string | null },
}));
vi.mock('../config', () => ({ config: runtime }));
vi.mock('../common/prisma.service', () => ({ PrismaService: class {} }));

const address = `0x${'ab'.repeat(20)}`;
const oldAddress = `0x${'cd'.repeat(20)}`;
const now = new Date('2026-10-12T10:00:00Z');

type Position = {
  chainId: number;
  contractAddress: string;
  keywordId: string;
  active: boolean;
  stakeRaw: string;
  eligible?: boolean;
  withdrawAvailableAt?: bigint;
};

function position(keyword: string, stakeRaw: string, overrides: Partial<Position> = {}): Position {
  return {
    chainId: 8453,
    contractAddress: address,
    keywordId: adKeywordId(keyword),
    active: true,
    stakeRaw,
    ...overrides,
  };
}

function fixture(
  campaigns = ['bitcoin', 'bitcoin', 'bitcoin cash', 'ethereum', 'unstaked'],
  positions: Position[] = [],
) {
  const state = {
    chainId: 8453,
    contractAddress: address,
    lastBlockNumber: 100n,
    configBlockNumber: 100n,
    minimumStakeRaw: '1',
    paused: false,
    operatorAddress: address,
    updatedAt: now,
  };
  const literal = (value: string) => value.replace(/\\([\\%_])/g, '$1');
  const names = (query = '') =>
    [...new Set(campaigns)]
      .filter((keyword) => keyword.toLowerCase().includes(literal(query).toLowerCase()))
      .sort();
  const tx = {
    adIndexerState: { findUnique: vi.fn().mockResolvedValue(state) },
    adCampaign: {
      groupBy: vi.fn(async (input) =>
        names(input.where.canonicalKeyword?.contains)
          .slice(input.skip, input.skip + input.take)
          .map((canonicalKeyword) => ({ canonicalKeyword })),
      ),
    },
    $queryRaw: vi.fn(async (query: Prisma.Sql) => {
      if (query.sql.includes('COUNT(DISTINCT')) {
        const pattern = query.values[0] as string | undefined;
        return [{ total: BigInt(names(pattern ? pattern.slice(1, -1) : '').length) }];
      }
      const [chainId, contractAddress, ...ids] = query.values;
      const totals = new Map<string, bigint>();
      for (const row of positions) {
        if (
          row.chainId !== chainId ||
          row.contractAddress !== contractAddress ||
          !row.active ||
          BigInt(row.stakeRaw) <= 0n ||
          !ids.includes(row.keywordId)
        )
          continue;
        totals.set(row.keywordId, (totals.get(row.keywordId) ?? 0n) + BigInt(row.stakeRaw));
      }
      return [...totals].map(([keywordId, value]) => ({ keywordId, stakeRaw: value.toString() }));
    }),
  };
  const db = {
    $transaction: vi.fn(async (read: (client: typeof tx) => Promise<unknown>) => read(tx)),
  };
  return { state, tx, db, service: new KeywordMarketKeywordsService(db as never) };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  runtime.adsContract.address = `0x${'AB'.repeat(20)}`;
});
afterEach(() => vi.useRealTimers());

describe('admin keyword registry and stake totals', () => {
  it('counts distinct registered keywords before paging and includes names with zero stake', async () => {
    const f = fixture();
    expect(await f.service.list()).toEqual({
      chainId: 8453,
      contractAddress: address,
      chainStatus: 'SYNCED',
      page: 1,
      pageSize: 20,
      total: 4,
      items: [
        { keyword: 'bitcoin', stakeRaw: '0' },
        { keyword: 'bitcoin cash', stakeRaw: '0' },
        { keyword: 'ethereum', stakeRaw: '0' },
        { keyword: 'unstaked', stakeRaw: '0' },
      ],
    });
    expect(f.tx.adCampaign.groupBy).toHaveBeenCalledWith({
      by: ['canonicalKeyword'],
      where: {},
      orderBy: { canonicalKeyword: 'asc' },
      skip: 0,
      take: 20,
    });
    expect(f.tx.$queryRaw.mock.calls[0]![0].sql).toContain('COUNT(DISTINCT "canonicalKeyword")');
    expect(f.db.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
  });

  it('sums all active positive wallets exactly, including manual and ineligible stakes, without campaign duplication', async () => {
    const f = fixture(undefined, [
      position('bitcoin', '1000000000000000000000000000001'),
      position('bitcoin', '2000000000000000000000000000002'),
      position('bitcoin', '7', { eligible: false, withdrawAvailableAt: 123n }),
      position('bitcoin', '999', { active: false }),
      position('bitcoin', '0'),
      position('bitcoin', '-10'),
      position('bitcoin', '999', { chainId: 84532 }),
      position('bitcoin', '999', { contractAddress: oldAddress }),
      position('unregistered manual keyword', '999'),
    ]);
    const view = await f.service.list();
    expect(view.items.find((row) => row.keyword === 'bitcoin')?.stakeRaw).toBe(
      '3000000000000000000000000000010',
    );
    expect(view.total).toBe(4);
    expect(view.items.some((row) => row.keyword === 'unregistered manual keyword')).toBe(false);
    const sql = f.tx.$queryRaw.mock.calls[1]![0];
    expect(sql.sql).toContain('SUM("stakeRaw"::numeric)::text');
    expect(sql.sql).toContain('"active" = true AND "stakeRaw"::numeric > 0');
    expect(sql.sql).not.toMatch(/JOIN|eligible|withdrawAvailableAt/);
    expect(sql.values.slice(0, 2)).toEqual([8453, address]);
  });

  it('finds literal case-insensitive substrings consistently in count and page selection', async () => {
    const f = fixture();
    const view = await f.service.list('ITCO');
    expect(view.total).toBe(2);
    expect(view.items.map((row) => row.keyword)).toEqual(['bitcoin', 'bitcoin cash']);
    expect(f.tx.$queryRaw.mock.calls[0]![0].values).toEqual(['%ITCO%', '\\']);
    expect(f.tx.adCampaign.groupBy.mock.calls[0]![0].where).toEqual({
      canonicalKeyword: { contains: 'ITCO', mode: 'insensitive' },
    });
  });

  it.each(['%', '_', '\\', "' OR 1=1 --"])(
    'does not treat search %s as a wildcard or SQL fragment',
    async (q) => {
      const f = fixture();
      expect((await f.service.list(q)).total).toBe(0);
      const query = f.tx.$queryRaw.mock.calls[0]![0];
      const escaped = q.replace(/[\\%_]/g, '\\$&');
      expect(query.values).toEqual([`%${escaped}%`, '\\']);
      expect(query.sql).not.toContain(q);
      expect(f.tx.adCampaign.groupBy.mock.calls[0]![0].where).toEqual({
        canonicalKeyword: { contains: escaped, mode: 'insensitive' },
      });
      expect(f.tx.$queryRaw).toHaveBeenCalledOnce();
    },
  );

  it('uses stable distinct alphabetical pages and clamps requests beyond the last page', async () => {
    const words = Array.from({ length: 43 }, (_, i) => `keyword ${String(i).padStart(2, '0')}`);
    const f = fixture([...words].reverse().concat(words.slice(0, 10)));
    const middle = await f.service.list('', 2);
    expect(middle.total).toBe(43);
    expect(middle.items.map((row) => row.keyword)).toEqual(words.slice(20, 40));
    const last = await f.service.list('', 99);
    expect(last.page).toBe(3);
    expect(last.items.map((row) => row.keyword)).toEqual(words.slice(40));
    expect(f.tx.adCampaign.groupBy.mock.calls[1]![0]).toMatchObject({ skip: 40, take: 20 });
  });

  it('returns page one for an empty registry without querying positions', async () => {
    const f = fixture([]);
    expect(await f.service.list('', 50)).toMatchObject({ page: 1, total: 0, items: [] });
    expect(f.tx.$queryRaw).toHaveBeenCalledOnce();
  });

  it('keeps registry names available without a configured contract and skips chain data', async () => {
    runtime.adsContract.address = null;
    const f = fixture();
    const view = await f.service.list();
    expect(view).toMatchObject({
      contractAddress: null,
      chainStatus: 'AWAITING_CONTRACT',
      total: 4,
    });
    expect(view.items.every((row) => row.stakeRaw === '0')).toBe(true);
    expect(f.tx.adIndexerState.findUnique).not.toHaveBeenCalled();
    expect(f.tx.$queryRaw).toHaveBeenCalledOnce();
  });

  it('marks a stale or missing checkpoint as syncing without hiding known keywords', async () => {
    const f = fixture();
    f.state.updatedAt = new Date(now.getTime() - 60_001);
    expect((await f.service.list()).chainStatus).toBe('SYNCING');
    f.tx.adIndexerState.findUnique.mockResolvedValue(null);
    expect((await f.service.list()).chainStatus).toBe('SYNCING');
  });
});
