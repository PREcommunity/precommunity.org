import type { Metadata } from 'next';
import { KeywordMarketAdminPanel } from '@/components/keyword-market-admin-panel';

export const metadata: Metadata = { title: 'Moderation' };

export default function KeywordMarketAdminPage() {
  return <KeywordMarketAdminPanel />;
}
