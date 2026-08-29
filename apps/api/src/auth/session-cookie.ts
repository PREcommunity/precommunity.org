import type { CookieOptions } from 'express';

export const SESSION_COOKIE_NAME = 'precommunity_session';

export function sessionCookieScope(): CookieOptions {
  return { path: '/' };
}
