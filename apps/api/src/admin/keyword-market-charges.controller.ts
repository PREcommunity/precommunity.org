import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { Role } from '@precommunity/database';
import { SessionGuard } from '../auth/session.guard';
import type { AuthenticatedRequest } from '../common/request-context';
import { Roles } from '../common/roles';
import { RolesGuard } from '../common/roles.guard';
import { AdChargeHistoryQueryDto, UpdateAdChargeSettingsDto } from './keyword-market-charges.dto';
import { KeywordMarketChargesService } from './keyword-market-charges.service';

@Controller('admin/keyword-market/charges')
@UseGuards(SessionGuard, RolesGuard)
export class KeywordMarketChargesController {
  constructor(
    @Inject(KeywordMarketChargesService) private readonly service: KeywordMarketChargesService,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @Roles(Role.SUPER_ADMIN, Role.CONTENT_ADMIN, Role.FINANCE_ADMIN)
  latest(
    @Query(
      new ValidationPipe({
        expectedType: AdChargeHistoryQueryDto,
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    )
    query: AdChargeHistoryQueryDto,
  ) {
    return this.service.latest(query.cursor);
  }

  @Patch('settings')
  @Header('Cache-Control', 'no-store')
  @Roles(Role.SUPER_ADMIN)
  settings(
    @Body(
      new ValidationPipe({
        expectedType: UpdateAdChargeSettingsDto,
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    )
    body: UpdateAdChargeSettingsDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.updateSettings(body, request.principal!);
  }

  @Post('run')
  @HttpCode(202)
  @Header('Cache-Control', 'no-store')
  @Roles(Role.SUPER_ADMIN)
  run(@Req() request: AuthenticatedRequest) {
    return this.service.run(request.principal!);
  }

  @Get('run/:jobId')
  @Header('Cache-Control', 'no-store')
  @Roles(Role.SUPER_ADMIN, Role.CONTENT_ADMIN, Role.FINANCE_ADMIN)
  runStatus(@Param('jobId', ParseUUIDPipe) jobId: string) {
    return this.service.runStatus(jobId);
  }
}
