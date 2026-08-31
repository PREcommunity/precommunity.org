import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RolesGuard } from '../common/roles.guard';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { SafeModule } from '../safe/safe.module';
import { GoalManagerSyncQueue } from './goal-manager-sync-queue.service';

@Module({
  imports: [AuthModule, SafeModule],
  controllers: [AdminController],
  providers: [AdminService, GoalManagerSyncQueue, RolesGuard],
})
export class AdminModule {}
