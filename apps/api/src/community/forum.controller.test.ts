import 'reflect-metadata';
import { ParseUUIDPipe } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { SessionGuard } from '../auth/session.guard';
import { ForumAdminController, ForumController } from './forum.controller';

function routePipes(controller: object, method: string) {
  const metadata = Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, method) as
    Record<string, { pipes?: unknown[] }> | undefined;
  return Object.values(metadata ?? {}).flatMap((argument) => argument.pipes ?? []);
}

describe('ForumController access boundaries', () => {
  it.each([
    'create',
    'update',
    'delete',
    'reply',
    'editReply',
    'deleteReply',
    'notifications',
    'markAllNotificationsRead',
    'markNotificationRead',
  ] as const)('keeps SessionGuard on %s', (method) => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, ForumController.prototype[method]) as
      unknown[] | undefined;
    expect(guards).toContain(SessionGuard);
  });

  it.each([
    'update',
    'delete',
    'reply',
    'editReply',
    'deleteReply',
    'markNotificationRead',
  ] as const)('validates the UUID path parameter on %s', (method) => {
    expect(routePipes(ForumController, method)).toContain(ParseUUIDPipe);
  });

  it.each(['approve', 'decline', 'lock', 'unlock', 'remove', 'removeReply'] as const)(
    'validates the admin UUID path parameter on %s',
    (method) => {
      expect(routePipes(ForumAdminController, method)).toContain(ParseUUIDPipe);
    },
  );
});
