import { Module } from '@nestjs/common';
import { AdminModule } from './admin/admin.module';
import { AuthModule } from './auth/auth.module';
import { HealthController } from './health/health.controller';
import { PublicModule } from './public/public.module';
import { CommunityModule } from './community/community.module';
import { PrismaModule } from './common/prisma.module';
import { AdsModule } from './ads/ads.module';
import { ApplicationFeaturesModule } from './features/application-features.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    PublicModule,
    AdminModule,
    CommunityModule,
    ApplicationFeaturesModule,
    AdsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
