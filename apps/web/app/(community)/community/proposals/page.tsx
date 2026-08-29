import { CommunityFeed } from '@/components/community-feed';
import { getCommunityProposals } from '@/lib/api';

export const metadata = {
  title: 'Community proposals',
  description: 'Propose, discuss and vote on goals for the Presearch ecosystem.',
};

export default async function CommunityProposalsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; category?: string }>;
}) {
  const query = await searchParams;
  const allowed = ['VOTING', 'PASSED', 'REJECTED', 'CONVERTED', 'DECLINED'] as const;
  const status = allowed.find((item) => item === query.status);
  return (
    <CommunityFeed
      proposals={await getCommunityProposals(status, query.category)}
      activeStatus={status}
      activeCategory={query.category}
    />
  );
}
