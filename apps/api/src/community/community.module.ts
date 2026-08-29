import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RolesGuard } from '../common/roles.guard';
import { CommunityController } from './community.controller';
import { CommunityService } from './community.service';
import { ForumAdminController, ForumController } from './forum.controller';
import { ForumService } from './forum.service';
import { TokenEligibilityService } from './token-eligibility.service';

@Module({
  imports: [AuthModule],
  controllers: [CommunityController, ForumController, ForumAdminController],
  providers: [CommunityService, ForumService, TokenEligibilityService, RolesGuard],
  exports: [TokenEligibilityService],
})
export class CommunityModule {}
