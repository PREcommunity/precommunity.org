import type { Metadata } from 'next';
import { KeywordMarketCampaignForm } from '@/components/keyword-market-campaign-form';

export const metadata: Metadata = { title: 'New campaign' };

export default function NewKeywordMarketCampaignPage() {
  return <KeywordMarketCampaignForm />;
}
