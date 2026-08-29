import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AdCreativeStatus, Role } from '@precommunity/database';
import type { Request } from 'express';
import { SessionGuard } from '../auth/session.guard';
import type { AuthenticatedRequest } from '../common/request-context';
import { Roles } from '../common/roles';
import { RolesGuard } from '../common/roles.guard';
import { KeywordMarketEnabledGuard } from '../features/keyword-market-enabled.guard';
import {
  CreateAdCampaignDto,
  CreateAdRevisionDto,
  ListAdAdminReportsDto,
  ModerateAdRevisionDto,
  ReportAdDto,
  ResolveAdReportsDto,
  UpdateAdCampaignDto,
} from './ads.dto';
import { AdsReportRateLimitGuard } from './ads-report-rate-limit.guard';
import { AdsService } from './ads.service';

@Controller('keyword-market')
@UseGuards(KeywordMarketEnabledGuard)
export class AdsController {
  constructor(@Inject(AdsService) private readonly service: AdsService) {}

  @Get('status')
  @Header('Cache-Control', 'no-store')
  status() {
    return this.service.chainSnapshot();
  }

  @Get('resolve')
  @Header('Cache-Control', 'no-store')
  @Header('X-Robots-Tag', 'noindex')
  resolve(@Query('q') query?: string) {
    return this.service.resolve(query);
  }

  @Get('keywords/:keyword')
  @Header('Cache-Control', 'no-store')
  keyword(@Param('keyword') keyword: string) {
    return this.service.keyword(keyword);
  }

  @Post('revisions/:revisionId/reports')
  @UseGuards(AdsReportRateLimitGuard)
  @HttpCode(HttpStatus.ACCEPTED)
  @Header('Cache-Control', 'no-store')
  report(
    @Param('revisionId', ParseUUIDPipe) revisionId: string,
    @Body() body: ReportAdDto,
    @Req() request: Request,
  ) {
    return this.service.report(
      revisionId,
      body,
      request.ip || request.socket.remoteAddress || 'unknown',
    );
  }

  @Get('campaigns/mine')
  @UseGuards(SessionGuard)
  mine(@Req() request: AuthenticatedRequest) {
    return this.service.mine(request.principal!);
  }

  @Post('campaigns')
  @UseGuards(SessionGuard)
  createCampaign(@Body() body: CreateAdCampaignDto, @Req() request: AuthenticatedRequest) {
    return this.service.createCampaign(body, request.principal!);
  }

  @Post('campaigns/:campaignId/revisions')
  @UseGuards(SessionGuard)
  createRevision(
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
    @Body() body: CreateAdRevisionDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.createRevision(campaignId, body, request.principal!);
  }

  @Patch('campaigns/:campaignId')
  @UseGuards(SessionGuard)
  updateCampaign(
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
    @Body() body: UpdateAdCampaignDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.updateCampaign(campaignId, body.paused, request.principal!);
  }
}

@Controller('keyword-market/admin')
@UseGuards(KeywordMarketEnabledGuard, SessionGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN, Role.CONTENT_ADMIN)
export class AdsAdminController {
  constructor(@Inject(AdsService) private readonly service: AdsService) {}

  @Get('revisions')
  revisions(
    @Query('status', new ParseEnumPipe(AdCreativeStatus, { optional: true }))
    status?: AdCreativeStatus,
  ) {
    return this.service.adminRevisions(status);
  }

  @Get('reports')
  reports(@Query() query: ListAdAdminReportsDto) {
    return this.service.adminReports(query.status, query.cursor, query.limit);
  }

  @Get('audit')
  audit() {
    return this.service.adminAudit();
  }

  @Post('revisions/:revisionId/moderate')
  moderate(
    @Param('revisionId', ParseUUIDPipe) revisionId: string,
    @Body() body: ModerateAdRevisionDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.moderateRevision(revisionId, body.action, body.note, request.principal!);
  }

  @Post('revisions/:revisionId/reports/resolve')
  resolveReports(
    @Param('revisionId', ParseUUIDPipe) revisionId: string,
    @Body() body: ResolveAdReportsDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.resolveReports(revisionId, body.action, body.note, request.principal!);
  }
}
