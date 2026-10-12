import type { Metadata } from 'next';
import { KeywordMarketCampaignEdit } from '@/components/keyword-market-campaign-edit';

export const metadata: Metadata = { title: 'Edit campaign' };

export default async function EditKeywordMarketCampaignPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <KeywordMarketCampaignEdit campaignId={id} />;
}
