'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X } from 'lucide-react';
import { useApplicationFeatures } from '@/hooks/use-application-features';
import { useWalletSession } from '@/hooks/use-wallet-session';
import { canAccessAdmin } from '@/lib/session-access';
import { BrandMark } from './brand-mark';
import { WalletButton } from './wallet-button';
import { ForumNotificationMenu } from './forum-notification-menu';
import { ThemeSwitcher } from './theme-switcher';

const communityLinks = [
  { href: '/', label: 'Home' },
  { href: '/community', label: 'Community' },
  { href: '/funding', label: 'Funding' },
  { href: '/about', label: 'About' },
];

export function SiteHeader() {
  const pathname = usePathname();
  const { canAccessSafeOwnershipAcceptance, sessionRoles } = useWalletSession();
  const { features } = useApplicationFeatures();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);
  const links = [
    ...communityLinks.slice(0, 3),
    ...(features.keywordMarketEnabled
      ? [{ href: '/keyword-market', label: 'Keyword Market' }]
      : []),
    ...communityLinks.slice(3),
    ...(canAccessAdmin(sessionRoles, canAccessSafeOwnershipAcceptance)
      ? [{ href: '/admin', label: 'Admin' }]
      : []),
  ];

  return (
    <header className="site-header">
      <Link
        href="/"
        className="inline-flex w-max items-center gap-2.5 tracking-[-.035em]"
        aria-label="PRE community home"
      >
        <BrandMark />
        <strong className="text-xl font-bold max-sm:text-[17px]">community</strong>
      </Link>
      <nav className={`site-nav ${open ? 'site-nav-open' : ''}`} aria-label="Primary navigation">
        {links.map((link) => (
          <Link
            className={`site-nav-link ${pathname === link.href || (link.href !== '/' && pathname.startsWith(`${link.href}/`)) ? 'site-nav-link-active' : ''}`}
            href={link.href}
            key={link.href}
          >
            {link.label}
          </Link>
        ))}
      </nav>
      <div className="flex items-center justify-self-end gap-2.5 max-sm:gap-1.5">
        <button
          className="site-menu-button"
          type="button"
          aria-label={open ? 'Close navigation' : 'Open navigation'}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
        <ThemeSwitcher />
        <ForumNotificationMenu />
        <WalletButton />
      </div>
    </header>
  );
}
