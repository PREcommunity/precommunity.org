import type { Metadata } from 'next';
import { KeywordMarketCampaignForm } from '@/components/keyword-market-campaign-form';

export const metadata: Metadata = { title: 'New campaign' };

export default async function NewKeywordMarketCampaignPage({
  searchParams,
}: {
  searchParams: Promise<{ keyword?: string | string[] }>;
}) {
  const { keyword } = await searchParams;
  return (
    <KeywordMarketCampaignForm
      initialKeyword={typeof keyword === 'string' ? keyword.slice(0, 256) : ''}
    />
  );
}
