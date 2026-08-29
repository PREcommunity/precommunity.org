import { ForumMine } from '@/components/forum-mine';

export const metadata = { title: 'Your forum topics' };

export default async function ForumMinePage({
  searchParams,
}: {
  searchParams: Promise<{ submitted?: string }>;
}) {
  const query = await searchParams;
  return <ForumMine submitted={query.submitted} />;
}
