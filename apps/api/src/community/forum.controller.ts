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
import { ForumCategory, Role } from '@precommunity/database';
import { SessionGuard } from '../auth/session.guard';
import type { AuthenticatedRequest } from '../common/request-context';
import { Roles } from '../common/roles';
import { RolesGuard } from '../common/roles.guard';
import { ModerationDto } from './community.dto';
import {
  CreateForumTopicDto,
  ForumDraftDto,
  ForumMinimumPreDto,
  ForumReplyDto,
  ForumSettingsDto,
  UpdateForumTopicDto,
} from './forum.dto';
import { ForumService } from './forum.service';

@Controller('community/forum')
export class ForumController {
  constructor(@Inject(ForumService) private readonly service: ForumService) {}

  @Get('config')
  config() {
    return this.service.config();
  }

  @Get('topics')
  list(
    @Query('category', new ParseEnumPipe(ForumCategory, { optional: true }))
    category?: ForumCategory,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.list(category, cursor, limit);
  }

  @Get('topics/mine')
  @UseGuards(SessionGuard)
  mine(@Req() request: AuthenticatedRequest) {
    return this.service.mine(request.principal!);
  }

  @Get('notifications')
  @UseGuards(SessionGuard)
  notifications(@Req() request: AuthenticatedRequest) {
    return this.service.notifications(request.principal!);
  }

  @Post('notifications/read-all')
  @UseGuards(SessionGuard)
  markAllNotificationsRead(@Req() request: AuthenticatedRequest) {
    return this.service.markAllNotificationsRead(request.principal!);
  }

  @Post('notifications/:id/read')
  @UseGuards(SessionGuard)
  markNotificationRead(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.markNotificationRead(id, request.principal!);
  }

  @Get('topics/:slug/replies')
  replies(
    @Param('slug') slug: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.replies(slug, cursor, limit);
  }

  @Get('topics/:slug')
  get(@Param('slug') slug: string) {
    return this.service.get(slug);
  }

  @Post('topics')
  @UseGuards(SessionGuard)
  create(@Body() body: CreateForumTopicDto, @Req() request: AuthenticatedRequest) {
    return this.service.create(body, request.principal!);
  }

  @Post('topics/drafts')
  @UseGuards(SessionGuard)
  createDraft(@Body() body: ForumDraftDto, @Req() request: AuthenticatedRequest) {
    return this.service.createDraft(body, request.principal!);
  }

  @Patch('topics/:id/draft')
  @UseGuards(SessionGuard)
  updateDraft(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ForumDraftDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.updateDraft(id, body, request.principal!);
  }

  @Post('topics/:id/publish')
  @UseGuards(SessionGuard)
  publishDraft(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CreateForumTopicDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.publishDraft(id, body, request.principal!);
  }

  @Patch('topics/:id')
  @UseGuards(SessionGuard)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateForumTopicDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.update(id, body, request.principal!);
  }

  @Delete('topics/:id')
  @UseGuards(SessionGuard)
  delete(@Param('id', ParseUUIDPipe) id: string, @Req() request: AuthenticatedRequest) {
    return this.service.delete(id, request.principal!);
  }

  @Post('topics/:id/replies')
  @UseGuards(SessionGuard)
  reply(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ForumReplyDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.reply(id, body, request.principal!);
  }

  @Put('replies/:id')
  @UseGuards(SessionGuard)
  editReply(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ForumReplyDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.editReply(id, body, request.principal!);
  }

  @Delete('replies/:id')
  @UseGuards(SessionGuard)
  deleteReply(@Param('id', ParseUUIDPipe) id: string, @Req() request: AuthenticatedRequest) {
    return this.service.deleteReply(id, request.principal!);
  }
}

@Controller('community/admin/forum')
@UseGuards(SessionGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN, Role.CONTENT_ADMIN)
export class ForumAdminController {
  constructor(@Inject(ForumService) private readonly service: ForumService) {}

  @Get()
  workspace() {
    return this.service.adminWorkspace();
  }

  @Put('settings')
  settings(@Body() body: ForumSettingsDto, @Req() request: AuthenticatedRequest) {
    return this.service.updateSettings(body, request.principal!);
  }

  @Put('settings/minimum-pre')
  minimumPre(@Body() body: ForumMinimumPreDto, @Req() request: AuthenticatedRequest) {
    return this.service.updateMinimumPre(body, request.principal!);
  }

  @Post('topics/:id/approve')
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ModerationDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.moderateTopic(id, 'APPROVE', body.note, request.principal!);
  }

  @Post('topics/:id/decline')
  decline(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ModerationDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.moderateTopic(id, 'DECLINE', body.note, request.principal!);
  }

  @Post('topics/:id/lock')
  lock(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ModerationDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.moderateTopic(id, 'LOCK', body.note, request.principal!);
  }

  @Post('topics/:id/unlock')
  unlock(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ModerationDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.moderateTopic(id, 'UNLOCK', body.note, request.principal!);
  }

  @Post('topics/:id/remove')
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ModerationDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.moderateTopic(id, 'REMOVE', body.note, request.principal!);
  }

  @Post('replies/:id/remove')
  removeReply(@Param('id', ParseUUIDPipe) id: string, @Req() request: AuthenticatedRequest) {
    return this.service.removeReply(id, request.principal!);
  }
}
