import 'reflect-metadata';
import {
  BadRequestException,
  type ExecutionContext,
  ForbiddenException,
  ParseUUIDPipe,
  ValidationPipe,
} from '@nestjs/common';
import {
  GUARDS_METADATA,
  HEADERS_METADATA,
  HTTP_CODE_METADATA,
  ROUTE_ARGS_METADATA,
} from '@nestjs/common/constants';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';
import { Reflector } from '@nestjs/core';
import { Role } from '@precommunity/database';
import { describe, expect, it, vi } from 'vitest';
import { SessionGuard } from '../auth/session.guard';
import { RolesGuard } from '../common/roles.guard';
import { KeywordMarketChargesController } from './keyword-market-charges.controller';
import { AdChargeHistoryQueryDto, UpdateAdChargeSettingsDto } from './keyword-market-charges.dto';

function context(method: keyof KeywordMarketChargesController, roles: Role[]): ExecutionContext {
  return {
    getHandler: () => KeywordMarketChargesController.prototype[method],
    getClass: () => KeywordMarketChargesController,
    switchToHttp: () => ({ getRequest: () => ({ principal: { roles } }) }),
  } as unknown as ExecutionContext;
}

function validationPipe(method: 'latest' | 'settings', type: RouteParamtypes): ValidationPipe {
  const parameters = Reflect.getMetadata(
    ROUTE_ARGS_METADATA,
    KeywordMarketChargesController,
    method,
  );
  return parameters[`${type}:0`].pipes[0];
}

describe('keyword market charge admin routes', () => {
  it('requires a session and checks roles on every route', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, KeywordMarketChargesController)).toEqual([
      SessionGuard,
      RolesGuard,
    ]);
  });

  it.each(['latest', 'runStatus'] as const)('allows all admin roles to read %s', (method) => {
    const guard = new RolesGuard(new Reflector());
    for (const role of [Role.SUPER_ADMIN, Role.CONTENT_ADMIN, Role.FINANCE_ADMIN]) {
      expect(guard.canActivate(context(method, [role]))).toBe(true);
    }
    expect(() => guard.canActivate(context(method, []))).toThrow(ForbiddenException);
  });

  it.each(['settings', 'run'] as const)('restricts %s to SUPER_ADMIN', (method) => {
    const guard = new RolesGuard(new Reflector());
    expect(guard.canActivate(context(method, [Role.SUPER_ADMIN]))).toBe(true);
    for (const roles of [[], [Role.CONTENT_ADMIN], [Role.FINANCE_ADMIN]]) {
      expect(() => guard.canActivate(context(method, roles))).toThrow(ForbiddenException);
    }
  });

  it.each(['latest', 'settings', 'run', 'runStatus'] as const)('prevents caching %s', (method) => {
    expect(
      Reflect.getMetadata(HEADERS_METADATA, KeywordMarketChargesController.prototype[method]),
    ).toContainEqual({ name: 'Cache-Control', value: 'no-store' });
  });

  it('queues asynchronous runs and validates their identifier', () => {
    expect(
      Reflect.getMetadata(HTTP_CODE_METADATA, KeywordMarketChargesController.prototype.run),
    ).toBe(202);
    const args = Reflect.getMetadata(
      ROUTE_ARGS_METADATA,
      KeywordMarketChargesController,
      'runStatus',
    ) as Record<string, { pipes?: unknown[] }>;
    expect(Object.values(args).flatMap((arg) => arg.pipes ?? [])).toContain(ParseUUIDPipe);
  });

  it.each([false, true])(
    'validates and forwards settings without DTO metadata: %s',
    async (enabled) => {
      const raw = { automaticEnabled: enabled, intervalMinutes: 10, clickThreshold: 50 };
      const pipe = validationPipe('settings', RouteParamtypes.BODY);
      const body = await pipe.transform(raw, { type: 'body', metatype: undefined });
      const service = { updateSettings: vi.fn() };
      const principal = { address: `0x${'11'.repeat(20)}` };

      new KeywordMarketChargesController(service as never).settings(body, { principal } as never);

      expect(body).toBeInstanceOf(UpdateAdChargeSettingsDto);
      expect(service.updateSettings).toHaveBeenCalledWith(raw, principal);
    },
  );

  it.each([
    {
      automaticEnabled: false,
      intervalMinutes: 10,
      clickThreshold: 50,
      contractAddress: 'another-contract',
    },
    { automaticEnabled: false, intervalMinutes: 10, clickThreshold: 50, readiness: 'READY' },
    { automaticEnabled: 'false', intervalMinutes: 10, clickThreshold: 50 },
    { automaticEnabled: false, intervalMinutes: 0, clickThreshold: 50 },
    { automaticEnabled: false, intervalMinutes: 10, clickThreshold: '50' },
    { automaticEnabled: false, intervalMinutes: 10 },
  ])('rejects unsafe settings without DTO metadata: %j', async (raw) => {
    const pipe = validationPipe('settings', RouteParamtypes.BODY);

    await expect(pipe.transform(raw, { type: 'body', metatype: undefined })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it.each([{}, { cursor: '564d4403-9a2d-480e-a3d8-fdabf2f0e5a7' }])(
    'validates and forwards history queries without DTO metadata: %j',
    async (raw) => {
      const pipe = validationPipe('latest', RouteParamtypes.QUERY);
      const query = await pipe.transform(raw, { type: 'query', metatype: undefined });
      const service = { latest: vi.fn() };

      new KeywordMarketChargesController(service as never).latest(query);

      expect(query).toBeInstanceOf(AdChargeHistoryQueryDto);
      expect(service.latest).toHaveBeenCalledWith('cursor' in raw ? raw.cursor : undefined);
    },
  );

  it.each([{ cursor: 'not-a-uuid' }, { cursor: ['bad', 'worse'] }, { unexpected: 'value' }])(
    'rejects unsafe history queries without DTO metadata: %j',
    async (raw) => {
      const pipe = validationPipe('latest', RouteParamtypes.QUERY);

      await expect(
        pipe.transform(raw, { type: 'query', metatype: undefined }),
      ).rejects.toBeInstanceOf(BadRequestException);
    },
  );
});
