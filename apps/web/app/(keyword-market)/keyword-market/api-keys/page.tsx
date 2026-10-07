import type { Metadata } from 'next';
import { KeywordMarketApiKeys } from '@/components/keyword-market-api-keys';

export const metadata: Metadata = { title: 'API keys' };

export default function KeywordMarketApiKeysPage() {
  return <KeywordMarketApiKeys />;
}
