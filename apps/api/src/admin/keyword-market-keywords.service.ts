import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@precommunity/database';
import { adKeywordId, type AdAdminKeywordPage } from '@precommunity/shared';
import { PrismaService } from '../common/prisma.service';
import { config } from '../config';

const PAGE_SIZE = 20;

@Injectable()
export class KeywordMarketKeywordsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(q = '', requestedPage = 1): Promise<AdAdminKeywordPage> {
    const chainId = config.deployment.chainId;
    const contractAddress = config.adsContract.address?.toLowerCase() ?? null;
    const escaped = q.replace(/[\\%_]/g, '\\$&');
    return this.prisma.$transaction(
      async (tx) => {
        const [count, state] = await Promise.all([
          tx.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`
          SELECT COUNT(DISTINCT "canonicalKeyword") AS "total" FROM "AdCampaign"
          ${q ? Prisma.sql`WHERE "canonicalKeyword" ILIKE ${`%${escaped}%`} ESCAPE ${'\\'}` : Prisma.empty}
        `),
          contractAddress
            ? tx.adIndexerState.findUnique({ where: { key: `${chainId}:${contractAddress}` } })
            : null,
        ]);
        const total = Number(count[0]?.total ?? 0n);
        const page = Math.min(requestedPage, Math.max(1, Math.ceil(total / PAGE_SIZE)));
        const keywords = await tx.adCampaign.groupBy({
          by: ['canonicalKeyword'],
          where: q ? { canonicalKeyword: { contains: escaped, mode: 'insensitive' } } : {},
          orderBy: { canonicalKeyword: 'asc' },
          skip: (page - 1) * PAGE_SIZE,
          take: PAGE_SIZE,
        });
        const stakes =
          contractAddress && keywords.length
            ? await tx.$queryRaw<Array<{ keywordId: string; stakeRaw: string }>>(Prisma.sql`
            SELECT "keywordId", SUM("stakeRaw"::numeric)::text AS "stakeRaw"
            FROM "AdStakePosition"
            WHERE "chainId" = ${chainId} AND "contractAddress" = ${contractAddress}
              AND "active" = true AND "stakeRaw"::numeric > 0
              AND "keywordId" IN (${Prisma.join(keywords.map(({ canonicalKeyword }) => adKeywordId(canonicalKeyword)))})
            GROUP BY "keywordId"
          `)
            : [];
        const byKeyword = new Map(stakes.map(({ keywordId, stakeRaw }) => [keywordId, stakeRaw]));
        const age = state ? Date.now() - state.updatedAt.getTime() : Infinity;
        const synced = Boolean(
          state &&
          state.chainId === chainId &&
          state.contractAddress.toLowerCase() === contractAddress &&
          age >= 0 &&
          age <= 60_000 &&
          state.configBlockNumber === state.lastBlockNumber &&
          state.minimumStakeRaw !== null &&
          state.paused !== null &&
          state.operatorAddress !== null,
        );
        return {
          chainId,
          contractAddress,
          chainStatus: !contractAddress ? 'AWAITING_CONTRACT' : synced ? 'SYNCED' : 'SYNCING',
          page,
          pageSize: PAGE_SIZE,
          total,
          items: keywords.map(({ canonicalKeyword: keyword }) => ({
            keyword,
            stakeRaw: byKeyword.get(adKeywordId(keyword)) ?? '0',
          })),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
