import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { KeywordMarketReportForm } from '@/components/keyword-market-report-form';

export const metadata: Metadata = { title: 'Report an ad' };

export default async function KeywordMarketReportPage({
  params,
}: {
  params: Promise<{ revisionId: string }>;
}) {
  const { revisionId } = await params;
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(revisionId)
  ) {
    notFound();
  }
  return <KeywordMarketReportForm key={revisionId} revisionId={revisionId} />;
}
