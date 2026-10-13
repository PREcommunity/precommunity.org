import { Controller, Get, Header, Inject, Query, UseGuards, ValidationPipe } from '@nestjs/common';
import { Role } from '@precommunity/database';
import { SessionGuard } from '../auth/session.guard';
import { Roles } from '../common/roles';
import { RolesGuard } from '../common/roles.guard';
import { AdAdminKeywordQueryDto } from './keyword-market-keywords.dto';
import { KeywordMarketKeywordsService } from './keyword-market-keywords.service';

@Controller('admin/keyword-market/keywords')
@UseGuards(SessionGuard, RolesGuard)
export class KeywordMarketKeywordsController {
  constructor(
    @Inject(KeywordMarketKeywordsService) private readonly service: KeywordMarketKeywordsService,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @Roles(Role.SUPER_ADMIN, Role.CONTENT_ADMIN, Role.FINANCE_ADMIN)
  list(
    @Query(
      new ValidationPipe({
        expectedType: AdAdminKeywordQueryDto,
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    )
    query: AdAdminKeywordQueryDto,
  ) {
    return this.service.list(query.q, query.page);
  }
}
