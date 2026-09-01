import Link from 'next/link';
import { ArrowUpRight, MessageSquareText, Vote } from 'lucide-react';
import { getCommunityProposals, getForumConfig, getForumTopics } from '@/lib/api';
import { formatUtcTimestamp, forumTopicTitle } from '@/lib/format';

export const metadata = {
  title: 'Community',
  description: 'Discuss ideas, shape proposals and take part in PRE-weighted community decisions.',
};

export default async function CommunityPage() {
  const [forum, forumConfig, proposals] = await Promise.all([
    getForumTopics({ limit: 5 }),
    getForumConfig(),
    getCommunityProposals(),
  ]);
  return (
    <main>
      <section className="page-gutter border-b border-line py-[54px] max-sm:py-[38px]">
        <header className="mb-[26px] grid grid-cols-[1fr_auto] items-end gap-7.5 max-sm:grid-cols-1">
          <h1 className="m-0 text-[32px] tracking-[-.035em]">Forum</h1>
          <Link
            className="inline-flex items-center gap-1.5 font-bold text-blue"
            href="/community/forum"
          >
            View forum <ArrowUpRight size={16} />
          </Link>
        </header>
        <div className="border-t border-navy">
          {forum.items.length ? (
            forum.items.map((topic, index) => (
              <Link
                className="group grid min-h-[88px] grid-cols-[24px_minmax(0,1fr)_180px_18px] items-center gap-[15px] border-b border-line transition-[padding] duration-180 hover:px-2.5 max-[900px]:grid-cols-[24px_minmax(0,1fr)_130px_18px] max-sm:min-h-[108px] max-sm:grid-cols-[20px_minmax(0,1fr)_16px]"
                href={`/community/forum/${topic.slug}`}
                key={topic.id}
              >
                <span className="font-mono text-[9px] text-blue">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <div className="min-w-0">
                  <small className="font-mono text-[9px] text-blue uppercase">
                    {forumConfig.categories.find((item) => item.value === topic.category)?.label ??
                      topic.category}
                  </small>
                  <strong className="my-[3px] block text-[17px]">
                    {forumTopicTitle(topic.title, topic.state)}
                  </strong>
                  <p className="m-0 overflow-hidden text-[11px] text-ellipsis whitespace-nowrap text-muted">
                    {topic.excerpt ?? 'The opening post is no longer available.'}
                  </p>
                </div>
                <aside className="flex items-center gap-1.5 text-[10px] text-muted max-sm:col-start-2">
                  <MessageSquareText size={14} /> {topic.replyCount}
                  <time className="ml-auto text-[8px]">
                    {formatUtcTimestamp(topic.lastActivityAt)}
                  </time>
                </aside>
                <ArrowUpRight
                  className="text-blue transition-transform duration-180 group-hover:translate-x-1 group-hover:-translate-y-1 max-sm:col-start-3 max-sm:row-start-1"
                  size={16}
                />
              </Link>
            ))
          ) : (
            <div className="border-y border-line py-7">
              <span className="hidden">00</span>
              <h2 className="m-0 text-lg">No forum topics yet.</h2>
              <p className="text-muted">Start the first community discussion.</p>
            </div>
          )}
        </div>
      </section>

      <section className="page-gutter border-b border-line bg-white py-[54px] max-sm:py-[38px]">
        <header className="mb-[26px] grid grid-cols-[1fr_auto] items-end gap-7.5 max-sm:grid-cols-1">
          <h2 className="m-0 text-[32px] tracking-[-.035em]">Proposals</h2>
          <Link
            className="inline-flex items-center gap-1.5 font-bold text-blue"
            href="/community/proposals"
          >
            View proposals <ArrowUpRight size={16} />
          </Link>
        </header>
        <div className="border-t border-navy">
          {proposals.length ? (
            proposals.slice(0, 5).map((proposal, index) => (
              <Link
                className="group grid min-h-[88px] grid-cols-[24px_minmax(0,1fr)_180px_18px] items-center gap-[15px] border-b border-line transition-[padding] duration-180 hover:px-2.5 max-[900px]:grid-cols-[24px_minmax(0,1fr)_130px_18px] max-sm:min-h-[108px] max-sm:grid-cols-[20px_minmax(0,1fr)_16px]"
                href={`/community/proposals/${proposal.slug}`}
                key={proposal.id}
              >
                <span className="font-mono text-[9px] text-blue">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <div className="min-w-0">
                  <small className="font-mono text-[9px] text-blue uppercase">
                    {proposal.category}
                  </small>
                  <strong className="my-[3px] block text-[17px]">{proposal.title}</strong>
                  <p className="m-0 overflow-hidden text-[11px] text-ellipsis whitespace-nowrap text-muted">
                    {proposal.description}
                  </p>
                </div>
                <aside className="flex items-center gap-1.5 text-[10px] text-muted max-sm:col-start-2">
                  <Vote size={14} /> {proposal.results.voterCount}
                  <em className="ml-auto text-[8px] not-italic">
                    {proposal.status.replaceAll('_', ' ')}
                  </em>
                </aside>
                <ArrowUpRight
                  className="text-blue transition-transform duration-180 group-hover:translate-x-1 group-hover:-translate-y-1 max-sm:col-start-3 max-sm:row-start-1"
                  size={16}
                />
              </Link>
            ))
          ) : (
            <div className="border-y border-line py-7">
              <span className="hidden">00</span>
              <h2 className="m-0 text-lg">No public proposals yet.</h2>
              <p className="text-muted">PRE holders can submit the first outcome for review.</p>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
