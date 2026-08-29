'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useWalletSession } from '@/hooks/use-wallet-session';
import { canModerateKeywordMarket } from '@/lib/session-access';
import { BrandMark } from './brand-mark';

const publicLinks = [
  { href: '/keyword-market', label: 'Resolver' },
  { href: '/keyword-market/campaigns', label: 'Campaigns' },
];

export function KeywordMarketSubnavigation() {
  const pathname = usePathname();
  const { sessionRoles } = useWalletSession();
  const links = canModerateKeywordMarket(sessionRoles)
    ? [...publicLinks, { href: '/keyword-market/admin', label: 'Moderation' }]
    : publicLinks;

  return (
    <div className="keyword-market-subnav">
      <div className="keyword-market-subnav-inner">
        <Link
          className="keyword-market-subnav-brand"
          href="/keyword-market"
          aria-label="PRE Keyword Market home"
        >
          <span>PRE</span>
          <strong>Keyword Market</strong>
        </Link>
        <nav className="keyword-market-subnav-links" aria-label="PRE Keyword Market navigation">
          {links.map((link) => {
            const active =
              link.href === '/keyword-market'
                ? pathname === '/keyword-market'
                : pathname === link.href || pathname.startsWith(`${link.href}/`);
            return (
              <Link
                className={`keyword-market-subnav-link ${active ? 'keyword-market-subnav-link-active' : ''}`}
                href={link.href}
                key={link.href}
                aria-current={active ? 'page' : undefined}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}

export function KeywordMarketFooter() {
  return (
    <footer className="site-footer">
      <span className="flex items-center gap-2 font-bold text-navy">
        <BrandMark className="size-6 max-sm:size-6" /> PRE Keyword Market
      </span>
      <span className="font-mono text-[10px]">Longest keyword match · highest eligible stake</span>
    </footer>
  );
}
