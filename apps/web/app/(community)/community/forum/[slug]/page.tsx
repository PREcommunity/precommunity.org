import { notFound } from 'next/navigation';
import { ForumTopicWorkspace } from '@/components/forum-topic-workspace';
import { getForumTopic } from '@/lib/api';

export default async function ForumTopicPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const topic = await getForumTopic(slug);
  if (!topic) notFound();
  return <ForumTopicWorkspace topic={topic} />;
}
