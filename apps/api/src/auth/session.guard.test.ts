import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { SessionGuard } from './session.guard';

function contextFor(request: Record<string, unknown>) {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as never;
}

describe('SessionGuard', () => {
  it('rejects a forum mutation without a SIWE session cookie', async () => {
    const authenticate = vi.fn();
    const guard = new SessionGuard({ authenticate } as never);

    await expect(guard.canActivate(contextFor({ cookies: {} }))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(authenticate).not.toHaveBeenCalled();
  });

  it('authenticates the cookie and attaches the current principal', async () => {
    const principal = { userId: 'user-1', address: '0x0000000000000000000000000000000000000001' };
    const authenticate = vi.fn().mockResolvedValue(principal);
    const request: Record<string, unknown> = {
      cookies: { precommunity_session: 'signed-session' },
    };
    const guard = new SessionGuard({ authenticate } as never);

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(authenticate).toHaveBeenCalledWith('signed-session');
    expect(request.principal).toBe(principal);
  });
});
