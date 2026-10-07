import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RolesGuard } from '../common/roles.guard';
import { ApplicationFeaturesModule } from '../features/application-features.module';
import { ADS_CHAIN_ADAPTER, ContractAdsChainAdapter } from './ads-chain.adapter';
import { AdsAdminController, AdsController } from './ads.controller';
import { AdsMetricsService } from './ads-metrics.service';
import { AdsReportRateLimitGuard } from './ads-report-rate-limit.guard';
import { AdsService } from './ads.service';
import { AdsApiKeyGuard } from './ads-api-key.guard';

@Module({
  imports: [AuthModule, ApplicationFeaturesModule],
  controllers: [AdsController, AdsAdminController],
  providers: [
    AdsService,
    AdsMetricsService,
    AdsReportRateLimitGuard,
    AdsApiKeyGuard,
    RolesGuard,
    ContractAdsChainAdapter,
    { provide: ADS_CHAIN_ADAPTER, useExisting: ContractAdsChainAdapter },
  ],
  exports: [AdsService],
})
export class AdsModule {}
