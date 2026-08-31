import { ForumMine } from '@/components/forum-mine';
import { getForumConfig } from '@/lib/api';

export const metadata = { title: 'Your forum topics' };

export default async function ForumMinePage({
  searchParams,
}: {
  searchParams: Promise<{ submitted?: string }>;
}) {
  const query = await searchParams;
  const config = await getForumConfig();
  return <ForumMine submitted={query.submitted} config={config} />;
}
