import { notFound } from 'next/navigation';
import { ForumTopicWorkspace } from '@/components/forum-topic-workspace';
import { getForumConfig, getForumTopic } from '@/lib/api';

export default async function ForumTopicPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [topic, config] = await Promise.all([getForumTopic(slug), getForumConfig()]);
  if (!topic) notFound();
  return <ForumTopicWorkspace topic={topic} config={config} />;
}
