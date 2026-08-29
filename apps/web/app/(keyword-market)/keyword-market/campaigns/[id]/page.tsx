import type { Metadata } from 'next';
import { KeywordMarketCampaignDetail } from '@/components/keyword-market-campaign-detail';

export const metadata: Metadata = { title: 'Campaign detail' };

export default async function KeywordMarketCampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <KeywordMarketCampaignDetail campaignId={id} />;
}
