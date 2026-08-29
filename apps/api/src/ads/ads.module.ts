import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RolesGuard } from '../common/roles.guard';
import { ApplicationFeaturesModule } from '../features/application-features.module';
import { ADS_CHAIN_ADAPTER, AwaitingContractAdsChainAdapter } from './ads-chain.adapter';
import { AdsAdminController, AdsController } from './ads.controller';
import { AdsMetricsService } from './ads-metrics.service';
import { AdsReportRateLimitGuard } from './ads-report-rate-limit.guard';
import { AdsService } from './ads.service';

@Module({
  imports: [AuthModule, ApplicationFeaturesModule],
  controllers: [AdsController, AdsAdminController],
  providers: [
    AdsService,
    AdsMetricsService,
    AdsReportRateLimitGuard,
    RolesGuard,
    AwaitingContractAdsChainAdapter,
    { provide: ADS_CHAIN_ADAPTER, useExisting: AwaitingContractAdsChainAdapter },
  ],
  exports: [AdsService],
})
export class AdsModule {}
