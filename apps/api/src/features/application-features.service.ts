import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { readApplicationFeatures, type ApplicationFeatures } from '@precommunity/database';
import type { AuthenticatedPrincipal } from '../common/request-context';
import { writeAuditEvent } from '../common/audit';
import { PrismaService } from '../common/prisma.service';

const PROJECT_SLUG = 'precommunity';

@Injectable()
export class ApplicationFeaturesService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  get() {
    return readApplicationFeatures(this.prisma);
  }

  updateKeywordMarket(enabled: boolean, actor: AuthenticatedPrincipal) {
    return this.updateKeywordMarketSetting(
      'keywordMarketEnabled',
      enabled,
      'UPDATE_KEYWORD_MARKET_AVAILABILITY',
      actor,
    );
  }

  updateKeywordMarketReview(requireReview: boolean, actor: AuthenticatedPrincipal) {
    return this.updateKeywordMarketSetting(
      'keywordMarketRequireReview',
      requireReview,
      'UPDATE_KEYWORD_MARKET_REVIEW_REQUIREMENT',
      actor,
    );
  }

  private async updateKeywordMarketSetting(
    field: keyof ApplicationFeatures,
    value: boolean,
    action: string,
    actor: AuthenticatedPrincipal,
  ): Promise<ApplicationFeatures> {
    const project = await this.prisma.project.findUnique({ where: { slug: PROJECT_SLUG } });
    if (!project) {
      throw new NotFoundException(
        'The precommunity project is not configured; run the database seed once',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw<
        Array<{ id: string }>
      >`SELECT "id" FROM "Project" WHERE "id" = ${project.id}::uuid FOR UPDATE`;
      const before = await tx.communitySettings.findUnique({ where: { projectId: project.id } });
      const settings = await tx.communitySettings.upsert({
        where: { projectId: project.id },
        update: { [field]: value, updatedBy: actor.address },
        create: {
          projectId: project.id,
          [field]: value,
          updatedBy: actor.address,
        },
      });
      await writeAuditEvent(tx, {
        projectId: project.id,
        actor,
        entityType: 'ApplicationFeatures',
        entityId: project.id,
        action,
        before: { [field]: before?.[field] ?? field === 'keywordMarketRequireReview' },
        after: { [field]: settings[field] },
      });
      return {
        keywordMarketEnabled: settings.keywordMarketEnabled,
        keywordMarketRequireReview: settings.keywordMarketRequireReview,
      };
    });
  }
}
