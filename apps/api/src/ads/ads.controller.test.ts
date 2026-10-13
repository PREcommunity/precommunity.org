import 'reflect-metadata';
import {
  GUARDS_METADATA,
  MODULE_METADATA,
  PATH_METADATA,
  ROUTE_ARGS_METADATA,
} from '@nestjs/common/constants';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';
import { describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import { Reflector } from '@nestjs/core';
import { GuardsContextCreator } from '@nestjs/core/guards/guards-context-creator';
import { GuardsConsumer } from '@nestjs/core/guards/guards-consumer';
import { Role } from '@precommunity/database';
import type { ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { KeywordMarketEnabledGuard } from '../features/keyword-market-enabled.guard';
import { ApplicationFeaturesService } from '../features/application-features.service';
import { SessionGuard } from '../auth/session.guard';
import { AdsAdminController, AdsController, AdsResolveController } from './ads.controller';
import { AdsModule } from './ads.module';
import { AdsApiKeyGuard } from './ads-api-key.guard';
import { RolesGuard } from '../common/roles.guard';

function resolverGuardChain() {
  const consume = vi.fn().mockResolvedValue(0);
  const findUnique = vi.fn().mockResolvedValue({
    id: 'key-1',
    revokedAt: null,
    lastUsedAt: new Date(),
  });
  const findFirst = vi.fn().mockResolvedValue({ keywordMarketEnabled: true });
  const prisma = { adApiKey: { findUnique }, communitySettings: { findFirst } };
  const apiKeyGuard = new AdsApiKeyGuard(prisma as never, { consume } as never);
  const enabledGuard = new KeywordMarketEnabledGuard(
    new ApplicationFeaturesService(prisma as never),
  );
  const injectables = new Map<unknown, unknown>([
    [AdsApiKeyGuard, { getInstanceByContextId: () => ({ instance: apiKeyGuard }) }],
    [KeywordMarketEnabledGuard, { getInstanceByContextId: () => ({ instance: enabledGuard }) }],
  ]);
  const creator = new GuardsContextCreator({
    getModules: () => new Map([['ads', { injectables }]]),
  } as never);
  const controller = new AdsResolveController({} as never);
  const guards = creator.create(controller, controller.resolve as never, 'ads');
  const response = { setHeader: vi.fn() };
  const activate = (header: unknown = `pkm_${'a'.repeat(43)}`) =>
    new GuardsConsumer().tryActivate(
      guards,
      [{ method: 'GET', headers: { 'x-api-key': header } }, response],
      controller,
      controller.resolve as never,
      'http',
    );
  return { activate, consume, findUnique, findFirst, response };
}

describe('PRE Keyword Market controller routing', () => {
  it('mounts public and authenticated endpoints under the neutral prefix', () => {
    expect(Reflect.getMetadata(PATH_METADATA, AdsController)).toBe('keyword-market');
    expect(Reflect.getMetadata(PATH_METADATA, AdsResolveController)).toBe('keyword-market');
    expect(Reflect.getMetadata(PATH_METADATA, AdsResolveController.prototype.resolve)).toBe(
      'resolve',
    );
    expect(Reflect.getMetadata(PATH_METADATA, AdsAdminController)).toBe('keyword-market/admin');
    expect(Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, AdsModule)).toContain(
      AdsResolveController,
    );
  });

  it('gates all controller surfaces behind the runtime feature flag', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, AdsController)).toContain(
      KeywordMarketEnabledGuard,
    );
    expect(Reflect.getMetadata(GUARDS_METADATA, AdsAdminController)).toContain(
      KeywordMarketEnabledGuard,
    );
    expect(Reflect.getMetadata(GUARDS_METADATA, AdsResolveController)).toContain(
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
    expect(Reflect.getMetadata(GUARDS_METADATA, AdsResolveController)).toEqual([
      AdsApiKeyGuard,
      KeywordMarketEnabledGuard,
    ]);
    expect(Reflect.getMetadata(GUARDS_METADATA, AdsController)).not.toContain(AdsApiKeyGuard);
    for (const handler of [
      AdsController.prototype.keyword,
      AdsController.prototype.report,
      AdsController.prototype.click,
    ]) {
      expect(Reflect.getMetadata(GUARDS_METADATA, handler) ?? []).not.toContain(AdsApiKeyGuard);
      expect(Reflect.getMetadata(GUARDS_METADATA, handler) ?? []).not.toContain(SessionGuard);
    }
  });

  it('rejects an exhausted resolver key before any PostgreSQL lookup in the real Nest guard chain', async () => {
    const chain = resolverGuardChain();
    chain.consume.mockResolvedValue(1_000);
    await expect(chain.activate()).rejects.toMatchObject({ status: 429 });
    expect(chain.response.setHeader).toHaveBeenCalledWith('Retry-After', '1');
    expect(chain.findUnique).not.toHaveBeenCalled();
    expect(chain.findFirst).not.toHaveBeenCalled();
  });

  it('rejects malformed resolver keys before rate limiting or feature lookup', async () => {
    const chain = resolverGuardChain();
    await expect(chain.activate('invalid')).rejects.toMatchObject({ status: 401 });
    expect(chain.consume).not.toHaveBeenCalled();
    expect(chain.findUnique).not.toHaveBeenCalled();
    expect(chain.findFirst).not.toHaveBeenCalled();
  });

  it('keeps the resolver unavailable when the feature is disabled after successful authentication', async () => {
    const chain = resolverGuardChain();
    chain.findFirst.mockResolvedValue({ keywordMarketEnabled: false });
    await expect(chain.activate()).rejects.toMatchObject({ status: 404 });
    expect(chain.consume).toHaveBeenCalledOnce();
    expect(chain.findUnique).toHaveBeenCalledOnce();
    expect(chain.findFirst).toHaveBeenCalledOnce();
    expect(chain.consume.mock.invocationCallOrder[0]).toBeLessThan(
      chain.findUnique.mock.invocationCallOrder[0]!,
    );
    expect(chain.findUnique.mock.invocationCallOrder[0]).toBeLessThan(
      chain.findFirst.mock.invocationCallOrder[0]!,
    );
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
      ip: '192.0.2.1',
      get: (name: string) => (name === 'sec-purpose' ? purpose : undefined),
    } as Request;
    new AdsResolveController(service as never).resolve(request, 'bitcoin');
    expect(service.resolve).toHaveBeenCalledWith('bitcoin', count);
    await expect(controller.click('revision-1', request, 'signed-delivery')).resolves.toEqual({
      url: 'https://wp.pl/',
      statusCode: 302,
    });
    expect(service.click).toHaveBeenCalledWith('revision-1', count, 'signed-delivery', '192.0.2.1');
  });
});
