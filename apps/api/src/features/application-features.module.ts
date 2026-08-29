import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RolesGuard } from '../common/roles.guard';
import {
  AdminApplicationFeaturesController,
  PublicApplicationFeaturesController,
} from './application-features.controller';
import { ApplicationFeaturesService } from './application-features.service';
import { KeywordMarketEnabledGuard } from './keyword-market-enabled.guard';

@Module({
  imports: [AuthModule],
  controllers: [PublicApplicationFeaturesController, AdminApplicationFeaturesController],
  providers: [ApplicationFeaturesService, KeywordMarketEnabledGuard, RolesGuard],
  exports: [ApplicationFeaturesService, KeywordMarketEnabledGuard],
})
export class ApplicationFeaturesModule {}
