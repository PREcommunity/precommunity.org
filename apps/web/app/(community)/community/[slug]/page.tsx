import { redirect } from 'next/navigation';

export default async function LegacyProposalPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  redirect(`/community/proposals/${encodeURIComponent(slug)}`);
}
