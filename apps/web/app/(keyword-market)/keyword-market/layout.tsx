import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import {
  KeywordMarketFooter,
  KeywordMarketSubnavigation,
} from '@/components/keyword-market-header';
import { SiteHeader } from '@/components/site-header';
import { getApplicationFeatures } from '@/lib/api';

export const metadata: Metadata = {
  title: { default: 'PRE Keyword Market', template: '%s · PRE Keyword Market' },
  description: 'Stake PRE on whole-token search keywords and attach a moderated text ad.',
  robots: { index: false, follow: false },
};

export default async function KeywordMarketLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const features = await getApplicationFeatures();
  if (!features.keywordMarketEnabled) notFound();

  return (
    <div className="flex min-h-screen min-h-svh flex-col">
      <SiteHeader />
      <KeywordMarketSubnavigation />
      {children}
      <KeywordMarketFooter />
    </div>
  );
}
