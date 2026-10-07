import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionRole } from '@/lib/session-access';
import { KeywordMarketSubnavigation } from './keyword-market-header';

const session = vi.hoisted(() => ({ sessionRoles: [] as SessionRole[] }));
vi.mock('@/hooks/use-wallet-session', () => ({ useWalletSession: () => session }));
vi.mock('next/navigation', () => ({ usePathname: () => '/keyword-market/api-keys' }));

describe('Keyword Market navigation', () => {
  beforeEach(() => {
    session.sessionRoles = [];
  });

  it('labels the public homepage Search', () => {
    const html = renderToStaticMarkup(<KeywordMarketSubnavigation />);
    expect(html).toContain('>Search</a>');
    expect(html).not.toContain('>Resolver</a>');
  });

  it.each(['CONTENT_ADMIN', 'FINANCE_ADMIN'] as const)('hides API keys for %s', (role) => {
    session.sessionRoles = [role];
    expect(renderToStaticMarkup(<KeywordMarketSubnavigation />)).not.toContain(
      'href="/keyword-market/api-keys"',
    );
  });

  it('exposes API keys only to super admins and marks the current page', () => {
    expect(renderToStaticMarkup(<KeywordMarketSubnavigation />)).not.toContain(
      'href="/keyword-market/api-keys"',
    );
    session.sessionRoles = ['SUPER_ADMIN'];
    const html = renderToStaticMarkup(<KeywordMarketSubnavigation />);
    expect(html).toContain('aria-current="page" href="/keyword-market/api-keys"');
    expect(html).toContain('href="/keyword-market/admin"');
  });
});
