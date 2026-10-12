import 'reflect-metadata';
import { GUARDS_METADATA, PATH_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';
import { describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import { Reflector } from '@nestjs/core';
import { Role } from '@precommunity/database';
import type { ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { KeywordMarketEnabledGuard } from '../features/keyword-market-enabled.guard';
import { SessionGuard } from '../auth/session.guard';
import { AdsAdminController, AdsController } from './ads.controller';
import { AdsApiKeyGuard } from './ads-api-key.guard';
import { RolesGuard } from '../common/roles.guard';

describe('PRE Keyword Market controller routing', () => {
  it('mounts public and authenticated endpoints under the neutral prefix', () => {
    expect(Reflect.getMetadata(PATH_METADATA, AdsController)).toBe('keyword-market');
    expect(Reflect.getMetadata(PATH_METADATA, AdsAdminController)).toBe('keyword-market/admin');
  });

  it('gates both controller surfaces behind the runtime feature flag', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, AdsController)).toContain(
      KeywordMarketEnabledGuard,
    );
    expect(Reflect.getMetadata(GUARDS_METADATA, AdsAdminController)).toContain(
      KeywordMarketEnabledGuard,
    );
  });

  it('exposes all stake preparation routes behind SIWE authentication', () => {
    expect(Reflect.getMetadata(PATH_METADATA, AdsController.prototype.prepareStake)).toBe(
      'campaigns/:campaignId/stake/prepare',
    );
    expect(Reflect.getMetadata(PATH_METADATA, AdsController.prototype.prepareRequestUnstake)).toBe(
      'campaigns/:campaignId/stake/request-unstake/prepare',
    );
    expect(Reflect.getMetadata(PATH_METADATA, AdsController.prototype.prepareUnstake)).toBe(
      'campaigns/:campaignId/stake/unstake/prepare',
    );
    for (const handler of [
      AdsController.prototype.prepareStake,
      AdsController.prototype.prepareRequestUnstake,
      AdsController.prototype.prepareUnstake,
    ]) {
      expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toContain(SessionGuard);
    }
  });

  it('protects the indexed transaction proof with SIWE authentication', () => {
    expect(Reflect.getMetadata(PATH_METADATA, AdsController.prototype.transaction)).toBe(
      'transactions/:txHash',
    );
    expect(Reflect.getMetadata(GUARDS_METADATA, AdsController.prototype.transaction)).toContain(
      SessionGuard,
    );
  });

  it('requires an API key for ad delivery while keeping ranking, reporting and redirects public', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, AdsController.prototype.resolve)).toContain(
      AdsApiKeyGuard,
    );
    for (const handler of [
      AdsController.prototype.keyword,
      AdsController.prototype.report,
      AdsController.prototype.click,
    ]) {
      expect(Reflect.getMetadata(GUARDS_METADATA, handler) ?? []).not.toContain(AdsApiKeyGuard);
      expect(Reflect.getMetadata(GUARDS_METADATA, handler) ?? []).not.toContain(SessionGuard);
    }
  });

  it('restricts every key management operation to SUPER_ADMIN despite moderator access to the controller', () => {
    const guard = new RolesGuard(new Reflector());
    for (const handler of [
      AdsAdminController.prototype.apiKeys,
      AdsAdminController.prototype.createApiKey,
      AdsAdminController.prototype.revokeApiKey,
    ]) {
      const context = (role: Role) =>
        ({
          getHandler: () => handler,
          getClass: () => AdsAdminController,
          switchToHttp: () => ({ getRequest: () => ({ principal: { roles: [role] } }) }),
        }) as unknown as ExecutionContext;
      expect(guard.canActivate(context(Role.SUPER_ADMIN))).toBe(true);
      expect(() => guard.canActivate(context(Role.CONTENT_ADMIN))).toThrow('required role');
      expect(() => guard.canActivate(context(Role.FINANCE_ADMIN))).toThrow('required role');
    }
  });

  it.each([
    [{}, 25],
    [{ status: 'OPEN', limit: '25' }, 25],
    [{ status: 'OPEN', limit: '100' }, 100],
  ])('parses report pagination without emitted DTO metadata: %j', async (raw, limit) => {
    const parameters = Reflect.getMetadata(ROUTE_ARGS_METADATA, AdsAdminController, 'reports');
    const pipe = parameters[`${RouteParamtypes.QUERY}:0`].pipes[0] as ValidationPipe;
    const query = await pipe.transform(raw, { type: 'query' });
    const service = { adminReports: vi.fn() };

    new AdsAdminController(service as never).reports(query);

    expect(service.adminReports).toHaveBeenCalledWith('OPEN', undefined, limit);
  });

  it.each([
    { limit: '0' },
    { limit: '101' },
    { limit: '1.5' },
    { limit: 'invalid' },
    { status: 'UNKNOWN' },
    { cursor: 'not-a-uuid' },
    { unexpected: 'value' },
  ])('rejects invalid report queries before querying Prisma: %j', async (raw) => {
    const parameters = Reflect.getMetadata(ROUTE_ARGS_METADATA, AdsAdminController, 'reports');
    const pipe = parameters[`${RouteParamtypes.QUERY}:0`].pipes[0] as ValidationPipe;

    await expect(pipe.transform(raw, { type: 'query' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it.each([
    ['GET', '', true],
    ['HEAD', '', false],
    ['GET', 'prefetch', false],
    ['GET', 'prefetch;prerender', false],
  ])('counts only navigations: %s %s', async (method, purpose, count) => {
    const service = { resolve: vi.fn(), click: vi.fn().mockResolvedValue('https://wp.pl/') };
    const controller = new AdsController(service as never);
    const request = {
      method,
      get: (name: string) => (name === 'sec-purpose' ? purpose : undefined),
    } as Request;
    controller.resolve(request, 'bitcoin');
    expect(service.resolve).toHaveBeenCalledWith('bitcoin', count);
    await expect(controller.click('revision-1', request, 'signed-delivery')).resolves.toEqual({
      url: 'https://wp.pl/',
      statusCode: 302,
    });
    expect(service.click).toHaveBeenCalledWith('revision-1', count, 'signed-delivery');
  });
});
