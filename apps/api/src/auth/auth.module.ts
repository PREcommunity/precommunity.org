import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthRateLimitGuard } from './auth-rate-limit.guard';
import { AuthService } from './auth.service';
import { SessionGuard } from './session.guard';
import { SafeModule } from '../safe/safe.module';

@Module({
  imports: [SafeModule],
  controllers: [AuthController],
  providers: [AuthService, AuthRateLimitGuard, SessionGuard],
  exports: [AuthService, SessionGuard],
})
export class AuthModule {}
