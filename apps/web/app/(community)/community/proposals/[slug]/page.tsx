import { notFound } from 'next/navigation';
import { ProposalWorkspace } from '@/components/proposal-workspace';
import { getCommunityProposal } from '@/lib/api';

export default async function ProposalPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const proposal = await getCommunityProposal(slug);
  if (!proposal) notFound();
  return <ProposalWorkspace proposal={proposal} />;
}
