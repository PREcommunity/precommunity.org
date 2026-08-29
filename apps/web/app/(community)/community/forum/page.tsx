import { ForumIndex } from '@/components/forum-index';
import { getForumConfig, getForumTopics } from '@/lib/api';
import { FORUM_CATEGORIES, type ForumCategory } from '@precommunity/shared';

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
  const category = FORUM_CATEGORIES.some((item) => item.value === query.category)
    ? (query.category as ForumCategory)
    : undefined;
  const [initialPage, config] = await Promise.all([getForumTopics({ category }), getForumConfig()]);
  return (
    <ForumIndex
      key={category ?? 'ALL'}
      initialPage={initialPage}
      config={config}
      activeCategory={category}
    />
  );
}
