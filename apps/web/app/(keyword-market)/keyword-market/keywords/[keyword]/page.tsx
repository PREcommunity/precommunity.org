import type { Metadata } from 'next';
import { KeywordMarketKeywordWorkspace } from '@/components/keyword-market-keyword-workspace';

export const metadata: Metadata = { title: 'Keyword ranking' };

export default async function KeywordMarketKeywordPage({
  params,
}: {
  params: Promise<{ keyword: string }>;
}) {
  const { keyword } = await params;
  return <KeywordMarketKeywordWorkspace keyword={keyword} />;
}
