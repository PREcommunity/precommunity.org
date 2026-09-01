import { ForumIndex } from '@/components/forum-index';
import { getForumConfig, getForumTopics } from '@/lib/api';

export const metadata = {
  title: 'Community forum',
  description: 'Public discussion for PRE holders and the wider Presearch community.',
};

export default async function ForumPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const query = await searchParams;
  const config = await getForumConfig();
  const category = config.categories.some((item) => item.value === query.category)
    ? query.category
    : undefined;
  const initialPage = await getForumTopics({ category });
  return (
    <ForumIndex
      key={category ?? 'ALL'}
      initialPage={initialPage}
      config={config}
      activeCategory={category}
    />
  );
}
