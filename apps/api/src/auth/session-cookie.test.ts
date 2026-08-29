import { describe, expect, it } from 'vitest';
import { sessionCookieScope } from './session-cookie';

describe('session cookie scope', () => {
  it('keeps the application session host-only and available to every path', () => {
    expect(sessionCookieScope()).toEqual({ path: '/' });
  });
});
