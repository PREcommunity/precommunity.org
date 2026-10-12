import {
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@precommunity/database';
import { SessionGuard } from '../auth/session.guard';
import { Roles } from '../common/roles';
import { RolesGuard } from '../common/roles.guard';
import { PreUsdPriceService } from './pre-usd-price.service';

@Controller('admin/pre-usd-price')
@UseGuards(SessionGuard, RolesGuard)
export class PreUsdPriceController {
  constructor(@Inject(PreUsdPriceService) private readonly service: PreUsdPriceService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @Roles(Role.SUPER_ADMIN, Role.CONTENT_ADMIN, Role.FINANCE_ADMIN)
  latest() {
    return this.service.latest();
  }

  @Post('refresh')
  @HttpCode(202)
  @Header('Cache-Control', 'no-store')
  @Roles(Role.SUPER_ADMIN)
  refresh() {
    return this.service.refresh();
  }

  @Get('refresh/:jobId')
  @Header('Cache-Control', 'no-store')
  @Roles(Role.SUPER_ADMIN)
  refreshStatus(@Param('jobId', ParseUUIDPipe) jobId: string) {
    return this.service.refreshStatus(jobId);
  }
}
