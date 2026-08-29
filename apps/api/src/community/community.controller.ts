import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { CommunityProposalStatus, Role } from '@precommunity/database';
import { SessionGuard } from '../auth/session.guard';
import type { AuthenticatedRequest } from '../common/request-context';
import { Roles } from '../common/roles';
import { RolesGuard } from '../common/roles.guard';
import {
  CommentDto,
  CreateProposalDto,
  ModerationDto,
  ProposalSettingsDto,
  UpdateProposalDto,
  VoteDto,
} from './community.dto';
import { CommunityService } from './community.service';

@Controller('community')
export class CommunityController {
  constructor(@Inject(CommunityService) private readonly service: CommunityService) {}

  @Get('proposals')
  list(
    @Query('status', new ParseEnumPipe(CommunityProposalStatus, { optional: true }))
    status?: CommunityProposalStatus,
    @Query('category') category?: string,
  ) {
    return this.service.list(status, category);
  }

  @Get('proposals/:slug')
  get(@Param('slug') slug: string) {
    return this.service.get(slug);
  }

  @Get('profiles/:address')
  profile(@Param('address') address: string) {
    return this.service.publicProfile(address);
  }

  @Get('membership')
  @UseGuards(SessionGuard)
  membership(@Req() request: AuthenticatedRequest) {
    return this.service.membership(request.principal!.address);
  }

  @Get('submissions/mine')
  @UseGuards(SessionGuard)
  mine(@Req() request: AuthenticatedRequest) {
    return this.service.mine(request.principal!);
  }

  @Post('proposals')
  @UseGuards(SessionGuard)
  create(@Body() body: CreateProposalDto, @Req() request: AuthenticatedRequest) {
    return this.service.create(body, request.principal!);
  }

  @Patch('proposals/:id')
  @UseGuards(SessionGuard)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateProposalDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.update(id, body, request.principal!);
  }

  @Post('proposals/:id/comments')
  @UseGuards(SessionGuard)
  comment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CommentDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.comment(id, body, request.principal!);
  }

  @Put('comments/:id')
  @UseGuards(SessionGuard)
  editComment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CommentDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.editComment(id, body, request.principal!);
  }

  @Delete('comments/:id')
  @UseGuards(SessionGuard)
  deleteComment(@Param('id', ParseUUIDPipe) id: string, @Req() request: AuthenticatedRequest) {
    return this.service.deleteComment(id, request.principal!);
  }

  @Put('proposals/:id/vote')
  @UseGuards(SessionGuard)
  vote(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: VoteDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.vote(id, body, request.principal!);
  }

  @Get('admin/proposals')
  @UseGuards(SessionGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.CONTENT_ADMIN)
  queue() {
    return this.service.moderationQueue();
  }

  @Post('admin/proposals/:id/open-voting')
  @UseGuards(SessionGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.CONTENT_ADMIN)
  open(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ModerationDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.openVoting(id, body, request.principal!);
  }

  @Put('admin/settings')
  @UseGuards(SessionGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.CONTENT_ADMIN)
  settings(@Body() body: ProposalSettingsDto, @Req() request: AuthenticatedRequest) {
    return this.service.updateSettings(body, request.principal!);
  }

  @Post('admin/proposals/:id/decline')
  @UseGuards(SessionGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.CONTENT_ADMIN)
  decline(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ModerationDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.decline(id, body, request.principal!);
  }

  @Post('admin/proposals/:id/remove')
  @UseGuards(SessionGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.CONTENT_ADMIN)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ModerationDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.remove(id, body, request.principal!);
  }

  @Post('admin/comments/:id/remove')
  @UseGuards(SessionGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.CONTENT_ADMIN)
  removeComment(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.removeComment(id);
  }
}
