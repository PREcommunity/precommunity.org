import 'reflect-metadata';
import {
  BadRequestException,
  ForbiddenException,
  type ExecutionContext,
  type ValidationPipe,
} from '@nestjs/common';
import {
  GUARDS_METADATA,
  HEADERS_METADATA,
  PATH_METADATA,
  ROUTE_ARGS_METADATA,
} from '@nestjs/common/constants';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';
import { Reflector } from '@nestjs/core';
import { Role } from '@precommunity/database';
import { describe, expect, it, vi } from 'vitest';
import { SessionGuard } from '../auth/session.guard';
import { RolesGuard } from '../common/roles.guard';
import { KeywordMarketKeywordsController } from './keyword-market-keywords.controller';
import { AdAdminKeywordQueryDto } from './keyword-market-keywords.dto';

function context(roles: Role[]): ExecutionContext {
  return {
    getHandler: () => KeywordMarketKeywordsController.prototype.list,
    getClass: () => KeywordMarketKeywordsController,
    switchToHttp: () => ({ getRequest: () => ({ principal: { roles } }) }),
  } as unknown as ExecutionContext;
}

function queryPipe(): ValidationPipe {
  const params = Reflect.getMetadata(ROUTE_ARGS_METADATA, KeywordMarketKeywordsController, 'list');
  return params[`${RouteParamtypes.QUERY}:0`].pipes[0];
}

describe('read-only admin keyword route', () => {
  it('registers the admin route with session/role guards and disables caching', () => {
    expect(Reflect.getMetadata(PATH_METADATA, KeywordMarketKeywordsController)).toBe(
      'admin/keyword-market/keywords',
    );
    expect(Reflect.getMetadata(GUARDS_METADATA, KeywordMarketKeywordsController)).toEqual([
      SessionGuard,
      RolesGuard,
    ]);
    expect(
      Reflect.getMetadata(HEADERS_METADATA, KeywordMarketKeywordsController.prototype.list),
    ).toContainEqual({ name: 'Cache-Control', value: 'no-store' });
  });

  it('permits all three admin roles and rejects ordinary wallets', () => {
    const guard = new RolesGuard(new Reflector());
    for (const role of [Role.SUPER_ADMIN, Role.CONTENT_ADMIN, Role.FINANCE_ADMIN])
      expect(guard.canActivate(context([role]))).toBe(true);
    expect(() => guard.canActivate(context([]))).toThrow(ForbiddenException);
  });

  it.each([{}, { q: 'bit', page: '2' }, { q: '%', page: '1' }, { q: '', page: '1000000' }])(
    'validates and forwards query %j without relying on emitted DTO metadata',
    async (input) => {
      const query = await queryPipe().transform(input, { type: 'query', metatype: undefined });
      const service = { list: vi.fn() };
      new KeywordMarketKeywordsController(service as never).list(query);
      expect(query).toBeInstanceOf(AdAdminKeywordQueryDto);
      expect(service.list).toHaveBeenCalledWith(
        'q' in input ? input.q : undefined,
        'page' in input ? Number(input.page) : 1,
      );
    },
  );

  it.each([
    { page: '0' },
    { page: '-1' },
    { page: '1.5' },
    { page: '1e3' },
    { page: '' },
    { page: '1000001' },
    { page: ['1', '2'] },
    { q: ['a', 'b'] },
    { q: 1 },
    { q: 'a'.repeat(65) },
    { pageSize: '100' },
    { contractAddress: 'other-contract' },
  ])('rejects invalid or caller-controlled query fields: %j', async (input) => {
    await expect(
      queryPipe().transform(input, { type: 'query', metatype: undefined }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
