import { KeywordMarketWorkspace } from '@/components/keyword-market-workspace';

export default async function KeywordMarketPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  return <KeywordMarketWorkspace initialQuery={q?.slice(0, 256) ?? ''} />;
}
