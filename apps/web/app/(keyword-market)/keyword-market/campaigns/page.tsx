import type { Metadata } from 'next';
import { KeywordMarketCampaignList } from '@/components/keyword-market-campaign-list';

export const metadata: Metadata = { title: 'Campaigns' };

export default function KeywordMarketCampaignsPage() {
  return <KeywordMarketCampaignList />;
}
