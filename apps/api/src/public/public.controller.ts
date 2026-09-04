import { Controller, Get, Inject, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PublicService } from './public.service';

@Controller('public')
export class PublicController {
  constructor(@Inject(PublicService) private readonly service: PublicService) {}

  @Get('dashboard')
  dashboard(@Query('month') month?: string) {
    return this.service.dashboard(month);
  }

  @Get('goal-previews/:token')
  goalPreview(@Param('token') token: string, @Res({ passthrough: true }) response: Response) {
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    response.setHeader('Referrer-Policy', 'no-referrer');
    return this.service.goalPreview(token);
  }

  @Get('goals/:slug')
  goal(@Param('slug') slug: string, @Query('month') month?: string) {
    return this.service.goal(slug, month);
  }

  @Get('goals/:slug/contributions')
  contributions(
    @Param('slug') slug: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.contributions(slug, cursor, limit);
  }

  @Get('goals/:slug/periods')
  periods(
    @Param('slug') slug: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.periods(slug, cursor, limit);
  }

  @Post('goals/:slug/settlement-request')
  settlementRequest(@Param('slug') slug: string, @Res({ passthrough: true }) response?: Response) {
    response?.setHeader('Cache-Control', 'no-store');
    return this.service.settlementRequest(slug);
  }

  @Get('profiles/:address/avatar')
  async avatar(
    @Param('address') address: string,
    @Query('revision') revision: string,
    @Res() response: Response,
  ) {
    const avatar = await this.service.avatar(address, revision);
    response
      .status(200)
      .setHeader('Content-Type', avatar.contentType)
      .setHeader('Content-Length', String(avatar.body.byteLength))
      .setHeader('X-Content-Type-Options', 'nosniff')
      .setHeader('Cache-Control', 'public, max-age=31536000, immutable')
      .send(avatar.body);
  }

  @Get('reports')
  async report(
    @Query('month') month?: string,
    @Query('year') year?: string,
    @Query('subproject') subproject?: string,
    @Query('category') category?: string,
    @Query('format') format = 'json',
    @Res({ passthrough: true }) response?: Response,
  ) {
    const report = await this.service.report({ month, year, subproject, category });
    if (format !== 'csv') return report;
    const rows = [
      'month,goal,subproject,category,goal_type,period_index,period_start,period_end,policy,first_settlement_at,settlement_day,asset,target,funded,released,surplus,carry_in,vested,carry_out,status,creation_tx',
    ];
    for (const dashboard of report.months) {
      for (const goal of dashboard.goals) {
        for (const item of goal.progress) {
          const period = goal.monthly?.selectedPeriod;
          const periodAsset = period?.assets.find((asset) => asset.asset === item.asset);
          rows.push(
            [
              dashboard.month,
              goal.title,
              goal.subproject?.name ?? '',
              goal.category ?? '',
              goal.goalType,
              period?.periodIndex ?? '',
              period?.startsAt ?? '',
              period?.endsAt ?? '',
              period?.surplusPolicy ?? '',
              goal.monthly?.firstSettlementAt ?? '',
              goal.monthly?.settlementDay ?? '',
              item.asset,
              item.target,
              item.funded,
              item.released,
              item.surplus,
              periodAsset?.carryIn ?? '',
              periodAsset?.vested ?? '',
              periodAsset?.carryOut ?? '',
              goal.status,
              goal.creationTxHash,
            ]
              .map((value) => `"${String(value).replaceAll('"', '""')}"`)
              .join(','),
          );
        }
      }
    }
    response
      ?.type('text/csv')
      .setHeader(
        'Content-Disposition',
        `attachment; filename="precommunity-${year ?? month ?? 'current'}.csv"`,
      );
    return rows.join('\n');
  }
}
