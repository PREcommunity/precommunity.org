import 'reflect-metadata';
import { ParseUUIDPipe } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { CommunityController } from './community.controller';

function routePipes(method: string) {
  const metadata = Reflect.getMetadata(ROUTE_ARGS_METADATA, CommunityController, method) as
    Record<string, { pipes?: unknown[] }> | undefined;
  return Object.values(metadata ?? {}).flatMap((argument) => argument.pipes ?? []);
}

describe('CommunityController identifiers', () => {
  it.each([
    'update',
    'comment',
    'editComment',
    'deleteComment',
    'vote',
    'open',
    'decline',
    'remove',
    'removeComment',
  ])('validates the UUID path parameter on %s', (method) => {
    expect(routePipes(method)).toContain(ParseUUIDPipe);
  });
});
