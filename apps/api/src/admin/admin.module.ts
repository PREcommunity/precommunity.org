import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RolesGuard } from '../common/roles.guard';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { SafeModule } from '../safe/safe.module';
import { GoalManagerSyncQueue } from './goal-manager-sync-queue.service';
import { PreUsdPriceController } from './pre-usd-price.controller';
import { PreUsdPriceService } from './pre-usd-price.service';
import { KeywordMarketChargesController } from './keyword-market-charges.controller';
import { KeywordMarketChargesService } from './keyword-market-charges.service';

@Module({
  imports: [AuthModule, SafeModule],
  controllers: [AdminController, PreUsdPriceController, KeywordMarketChargesController],
  providers: [
    AdminService,
    GoalManagerSyncQueue,
    PreUsdPriceService,
    KeywordMarketChargesService,
    RolesGuard,
  ],
})
export class AdminModule {}
