import type { ExecutionContext } from '@nestjs/common';
import { HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { AuthRateLimitGuard } from './auth-rate-limit.guard';

function context(): ExecutionContext {
  const request = { path: '/nonce', ip: '203.0.113.10', socket: {} };
  return { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
}

describe('AuthRateLimitGuard', () => {
  it('rejects repeated authentication attempts from one client', () => {
    const guard = new AuthRateLimitGuard();
    for (let attempt = 0; attempt < 10; attempt += 1)
      expect(guard.canActivate(context())).toBe(true);
    expect(() => guard.canActivate(context())).toThrow(HttpException);
  });
});
