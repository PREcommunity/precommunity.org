import type { ExecutionContext } from '@nestjs/common';
import { HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { AdsReportRateLimitGuard } from './ads-report-rate-limit.guard';

function context(ip: string): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ ip, socket: {} }) }),
  } as unknown as ExecutionContext;
}

describe('PRE Keyword Market report rate limiting', () => {
  it('allows five reports per IP and rejects the sixth', () => {
    const guard = new AdsReportRateLimitGuard();
    for (let index = 0; index < 5; index += 1)
      expect(guard.canActivate(context('192.0.2.1'))).toBe(true);
    expect(() => guard.canActivate(context('192.0.2.1'))).toThrow(HttpException);
    expect(guard.canActivate(context('192.0.2.2'))).toBe(true);
  });
});
