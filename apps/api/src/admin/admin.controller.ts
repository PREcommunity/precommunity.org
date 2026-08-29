import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@precommunity/database';
import { SessionGuard } from '../auth/session.guard';
import type { AuthenticatedRequest } from '../common/request-context';
import { Roles } from '../common/roles';
import { RolesGuard } from '../common/roles.guard';
import { SubmitSafePayoutProposalDto, SubmitSafeTransactionProposalDto } from '../safe/safe.dto';
import { AdminService } from './admin.service';
import {
  AssignRolesDto,
  ChainSubmissionDto,
  CreateExpenseDto,
  CreateSubprojectDto,
  ModerateProfileDto,
  PrepareGoalLifecycleDto,
  ReleaseProposalDto,
  UpdateGoalManagerDto,
  UpdateExpenseDto,
} from './admin.dto';

@Controller('admin')
@UseGuards(SessionGuard, RolesGuard)
export class AdminController {
  constructor(@Inject(AdminService) private readonly service: AdminService) {}

  @Get('workspace')
  @Roles(Role.SUPER_ADMIN, Role.CONTENT_ADMIN, Role.FINANCE_ADMIN)
  list() {
    return this.service.list();
  }

  @Get('safe/status')
  safeStatus(@Req() request: AuthenticatedRequest) {
    return this.service.safeStatus(request.principal!);
  }

  @Get('goal-managers')
  @Roles(Role.SUPER_ADMIN, Role.CONTENT_ADMIN, Role.FINANCE_ADMIN)
  goalManagers(@Req() request: AuthenticatedRequest) {
    return this.service.goalManagers(request.principal!);
  }

  @Post('goal-managers/safe-sync/prepare')
  @Roles(Role.SUPER_ADMIN)
  prepareSafeGoalManagerSync(@Req() request: AuthenticatedRequest) {
    return this.service.prepareSafeGoalManagerSync(request.principal!);
  }

  @Put('goal-managers/:address')
  @Roles(Role.SUPER_ADMIN)
  updateGoalManager(
    @Param('address') address: string,
    @Body() body: UpdateGoalManagerDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.updateGoalManager(address, body, request.principal!);
  }

  @Post('goal-manager-intents/:id/submit')
  @Roles(Role.SUPER_ADMIN)
  submitSafeGoalManagerIntent(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SubmitSafeTransactionProposalDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.submitSafeGoalManagerIntent(id, body, request.principal!);
  }

  @Post('safe/ownership-transfer')
  @Roles(Role.SUPER_ADMIN)
  prepareSafeOwnershipTransfer(@Req() request: AuthenticatedRequest) {
    return this.service.prepareSafeOwnershipTransfer(request.principal!);
  }

  @Post('safe/ownership-acceptance')
  prepareSafeOwnershipAcceptance(@Req() request: AuthenticatedRequest) {
    return this.service.prepareSafeOwnershipAcceptance(request.principal!);
  }

  @Post('safe/ownership-acceptance/submit')
  submitSafeOwnershipAcceptance(
    @Body() body: SubmitSafeTransactionProposalDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.submitSafeOwnershipAcceptance(body, request.principal!);
  }

  @Get('safe-payout-proposals')
  @Roles(Role.SUPER_ADMIN, Role.FINANCE_ADMIN)
  safePayoutProposals() {
    return this.service.safePayoutProposals();
  }

  @Post('subprojects')
  @Roles(Role.SUPER_ADMIN, Role.CONTENT_ADMIN)
  createSubproject(@Body() body: CreateSubprojectDto, @Req() request: AuthenticatedRequest) {
    return this.service.createSubproject(body, request.principal!);
  }

  @Post('expenses')
  @Roles(Role.SUPER_ADMIN, Role.CONTENT_ADMIN)
  createExpense(@Body() body: CreateExpenseDto, @Req() request: AuthenticatedRequest) {
    return this.service.createExpense(body, request.principal!);
  }

  @Post('community-proposals/:id/convert')
  @Roles(Role.SUPER_ADMIN, Role.CONTENT_ADMIN)
  convertProposal(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CreateExpenseDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.createExpense(body, request.principal!, id);
  }

  @Patch('expenses/:id')
  @Roles(Role.SUPER_ADMIN, Role.CONTENT_ADMIN)
  updateExpense(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateExpenseDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.updateExpense(id, body, request.principal!);
  }

  @Delete('expenses/:id')
  @Roles(Role.SUPER_ADMIN, Role.CONTENT_ADMIN)
  archiveExpense(@Param('id', ParseUUIDPipe) id: string, @Req() request: AuthenticatedRequest) {
    return this.service.archiveExpense(id, request.principal!);
  }

  @Post('expenses/:id/publish')
  @Roles(Role.SUPER_ADMIN, Role.CONTENT_ADMIN)
  publishExpense(@Param('id', ParseUUIDPipe) id: string, @Req() request: AuthenticatedRequest) {
    return this.service.publishExpense(id, request.principal!);
  }

  @Post('expenses/:id/submitted')
  @Roles(Role.SUPER_ADMIN, Role.CONTENT_ADMIN)
  markExpenseSubmitted(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ChainSubmissionDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.markExpenseSubmitted(id, body, request.principal!);
  }

  @Post('goals/:id/close-proposal')
  @Roles(Role.SUPER_ADMIN, Role.FINANCE_ADMIN)
  close(@Param('id', ParseUUIDPipe) id: string, @Req() request: AuthenticatedRequest) {
    return this.service.closeProposal(id, request.principal!);
  }

  @Post('goals/:id/cancel-proposal')
  @Roles(Role.SUPER_ADMIN, Role.FINANCE_ADMIN)
  cancel(@Param('id', ParseUUIDPipe) id: string, @Req() request: AuthenticatedRequest) {
    return this.service.cancelProposal(id, request.principal!);
  }

  @Get('safe-goal-action-proposals')
  @Roles(Role.SUPER_ADMIN, Role.FINANCE_ADMIN)
  safeGoalActionProposals() {
    return this.service.safeGoalActionProposals();
  }

  @Post('goals/:id/lifecycle-intents')
  @Roles(Role.SUPER_ADMIN, Role.FINANCE_ADMIN)
  prepareGoalLifecycle(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: PrepareGoalLifecycleDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.prepareGoalLifecycle(id, body, request.principal!);
  }

  @Post('safe-goal-action-intents/:id/submit')
  @Roles(Role.SUPER_ADMIN, Role.FINANCE_ADMIN)
  submitSafeGoalAction(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SubmitSafeTransactionProposalDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.submitSafeGoalAction(id, body, request.principal!);
  }

  @Post('goals/:id/safe-payout-intents')
  @Roles(Role.SUPER_ADMIN, Role.FINANCE_ADMIN)
  createSafePayoutIntent(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ReleaseProposalDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.createSafePayoutIntent(id, body, request.principal!);
  }

  @Post('safe-payout-intents/:id/submit')
  @Roles(Role.SUPER_ADMIN, Role.FINANCE_ADMIN)
  submitSafePayoutProposal(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SubmitSafePayoutProposalDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.submitSafePayoutProposal(id, body, request.principal!);
  }

  @Get('audit')
  @Roles(Role.SUPER_ADMIN, Role.CONTENT_ADMIN, Role.FINANCE_ADMIN)
  audit() {
    return this.service.auditLog();
  }

  @Put('users/roles')
  @Roles(Role.SUPER_ADMIN)
  assignRoles(@Body() body: AssignRolesDto, @Req() request: AuthenticatedRequest) {
    return this.service.assignRoles(body, request.principal!);
  }

  @Patch('sponsor-profiles/:userId/moderation')
  @Roles(Role.SUPER_ADMIN, Role.CONTENT_ADMIN)
  moderateProfile(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() body: ModerateProfileDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.moderateProfile(userId, body, request.principal!);
  }
}
