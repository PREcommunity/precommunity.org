import { Body, Controller, Get, Header, Inject, Put, Req, UseGuards } from '@nestjs/common';
import { Role } from '@precommunity/database';
import { SessionGuard } from '../auth/session.guard';
import type { AuthenticatedRequest } from '../common/request-context';
import { Roles } from '../common/roles';
import { RolesGuard } from '../common/roles.guard';
import { UpdateKeywordMarketFeatureDto } from './application-features.dto';
import { ApplicationFeaturesService } from './application-features.service';

@Controller('public/features')
export class PublicApplicationFeaturesController {
  constructor(
    @Inject(ApplicationFeaturesService) private readonly features: ApplicationFeaturesService,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  get() {
    return this.features.get();
  }
}

@Controller('admin/features')
@UseGuards(SessionGuard, RolesGuard)
export class AdminApplicationFeaturesController {
  constructor(
    @Inject(ApplicationFeaturesService) private readonly features: ApplicationFeaturesService,
  ) {}

  @Put('keyword-market')
  @Roles(Role.SUPER_ADMIN)
  updateKeywordMarket(
    @Body() body: UpdateKeywordMarketFeatureDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.features.updateKeywordMarket(body.enabled, request.principal!);
  }
}
