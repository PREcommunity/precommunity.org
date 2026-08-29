import Link from 'next/link';
import { ArrowUpRight, MessageSquareText, Vote } from 'lucide-react';
import { redirect } from 'next/navigation';
import { FORUM_CATEGORIES } from '@precommunity/shared';
import { GoalList } from '@/components/goal-list';
import { getCommunityProposals, getDashboardAvailability, getForumTopics } from '@/lib/api';
import { formatAmount, formatUtcTimestamp, forumTopicTitle, shortAddress } from '@/lib/format';
import { activeDeployment, activeExplorerAddress } from '@/lib/deployment';

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const query = await searchParams;
  if (query.month) redirect(`/funding?month=${encodeURIComponent(query.month)}`);
  const [dashboardAvailability, forum, proposalResults] = await Promise.all([
    getDashboardAvailability(),
    getForumTopics({ limit: 3 }),
    getCommunityProposals(),
  ]);
  const dashboard = dashboardAvailability.dashboard;
  const proposals = [...proposalResults]
    .sort(
      (a, b) =>
        Number(b.status === 'VOTING') - Number(a.status === 'VOTING') ||
        Date.parse(b.createdAt) - Date.parse(a.createdAt),
    )
    .slice(0, 3);
  const isIndexerUnavailable = dashboardAvailability.status === 'UNAVAILABLE';
  const isPendingDeployment = dashboard?.syncStatus === 'AWAITING_DEPLOYMENT';
  const pre = dashboard?.totals.find((item) => item.asset === 'PRE');
  const usdc = dashboard?.totals.find((item) => item.asset === 'USDC');

  return (
    <main data-testid="home-page">
      <section className="home-hero">
        <div className="home-hero-copy">
          <h1 className="home-hero-title">PRE community</h1>
          <p className="home-hero-lede">
            <strong className="text-white">
              The PRE Community is a public, community-funded effort to rebuild decentralized search
              - in the open, on a ledger anyone can audit.
            </strong>
          </p>
        </div>
        <aside className="home-hero-status" aria-label="Chain index status">
          <span className="home-hero-status-label">
            {isIndexerUnavailable
              ? 'Indexer catching up'
              : isPendingDeployment
                ? 'Deployment pending'
                : 'Verified sync'}
          </span>
          <strong className="home-hero-status-number">
            {dashboard ? dashboard.goals.length.toString().padStart(2, '0') : '--'}
          </strong>
          <small className="home-hero-status-copy">
            {isIndexerUnavailable
              ? 'verified funding temporarily unavailable'
              : 'verified funding goals'}
          </small>
          <dl className="home-hero-facts">
            <div className="home-hero-fact">
              <dt>Network</dt>
              <dd className="m-0 font-mono">
                {dashboard?.network ?? activeDeployment.networkName}
              </dd>
            </div>
            <div className="home-hero-fact">
              <dt>Escrow</dt>
              <dd className="m-0 font-mono" title={dashboard?.escrowAddress}>
                {isIndexerUnavailable ? (
                  'Awaiting fresh index'
                ) : isPendingDeployment ? (
                  'Awaiting address'
                ) : (
                  <a
                    className="inline-flex items-center gap-1 text-blue hover:text-white"
                    href={activeExplorerAddress(dashboard!.escrowAddress)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {shortAddress(dashboard!.escrowAddress)}
                    <ArrowUpRight size={12} />
                  </a>
                )}
              </dd>
            </div>
          </dl>
        </aside>
      </section>

      <section className="home-section bg-blue-soft" data-testid="home-section" id="community">
        <header className="home-section-header">
          <h2 className="home-section-title">Community</h2>
        </header>
        <div className="home-community-grid">
          <div className="min-w-0 border-t border-navy">
            <div className="flex justify-between gap-5 border-b border-line py-2 text-[9px] font-mono text-muted uppercase">
              <span>Latest forum topics</span>
              <Link className="text-blue" href="/community/forum">
                View forum
              </Link>
            </div>
            {forum.items.length ? (
              forum.items.map((topic, index) => (
                <Link
                  className="group grid min-h-[104px] grid-cols-[22px_minmax(0,1fr)_auto_16px] items-center gap-3 border-b border-line transition-[padding] duration-180 hover:px-2.5 max-sm:min-h-[114px] max-sm:grid-cols-[20px_minmax(0,1fr)_16px] motion-safe:[animation:row-rise_.45s_var(--row-delay)_cubic-bezier(.16,1,.3,1)_both]"
                  href={`/community/forum/${topic.slug}`}
                  key={topic.id}
                  style={{ '--row-delay': `${index * 55}ms` } as React.CSSProperties}
                >
                  <span className="font-mono text-[9px] text-blue">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <div className="flex min-w-0 flex-col">
                    <small className="font-mono text-[9px] text-blue uppercase">
                      {FORUM_CATEGORIES.find((item) => item.value === topic.category)?.label}
                    </small>
                    <strong className="my-1 overflow-hidden text-[15px] text-ellipsis whitespace-nowrap">
                      {forumTopicTitle(topic.title, topic.state)}
                    </strong>
                    <em className="text-[9px] text-muted not-italic">
                      {formatUtcTimestamp(topic.lastActivityAt)}
                    </em>
                  </div>
                  <aside className="flex items-center gap-1.5 text-[10px] text-muted max-sm:col-start-2">
                    {<MessageSquareText size={14} />} {topic.replyCount}
                  </aside>
                  <ArrowUpRight
                    className="text-blue transition-transform duration-180 group-hover:translate-x-1 group-hover:-translate-y-1 max-sm:col-start-3 max-sm:row-start-1"
                    size={16}
                  />
                </Link>
              ))
            ) : (
              <p className="m-0 py-6 text-muted">No forum topics yet.</p>
            )}
          </div>
          <div className="min-w-0 border-t border-navy">
            <div className="flex justify-between gap-5 border-b border-line py-2 text-[9px] font-mono text-muted uppercase">
              <span>Community proposals</span>
              <Link className="text-blue" href="/community/proposals">
                View proposals
              </Link>
            </div>
            {proposals.length ? (
              proposals.map((proposal, index) => (
                <Link
                  className="group grid min-h-[104px] grid-cols-[22px_minmax(0,1fr)_auto_16px] items-center gap-3 border-b border-line transition-[padding] duration-180 hover:px-2.5 max-sm:min-h-[114px] max-sm:grid-cols-[20px_minmax(0,1fr)_16px] motion-safe:[animation:row-rise_.45s_var(--row-delay)_cubic-bezier(.16,1,.3,1)_both]"
                  href={`/community/proposals/${proposal.slug}`}
                  key={proposal.id}
                  style={{ '--row-delay': `${index * 55 + 90}ms` } as React.CSSProperties}
                >
                  <span className="font-mono text-[9px] text-blue">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <div className="flex min-w-0 flex-col">
                    <small className="font-mono text-[9px] text-blue uppercase">
                      {proposal.category}
                    </small>
                    <strong className="my-1 overflow-hidden text-[15px] text-ellipsis whitespace-nowrap">
                      {proposal.title}
                    </strong>
                    <em className="text-[9px] text-muted not-italic">
                      {proposal.status.replaceAll('_', ' ')}
                    </em>
                  </div>
                  <aside className="flex items-center gap-1.5 text-[10px] text-muted max-sm:col-start-2">
                    {<Vote size={14} />} {proposal.results.voterCount}
                  </aside>
                  <ArrowUpRight
                    className="text-blue transition-transform duration-180 group-hover:translate-x-1 group-hover:-translate-y-1 max-sm:col-start-3 max-sm:row-start-1"
                    size={16}
                  />
                </Link>
              ))
            ) : (
              <p className="m-0 py-6 text-muted">No public proposals yet.</p>
            )}
          </div>
        </div>
      </section>

      <section className="home-section bg-white" data-testid="home-section" id="goals">
        <header className="home-section-header">
          <h2 className="home-section-title">Funding</h2>
        </header>
        {dashboard ? (
          <>
            <div className="mb-7.5 grid grid-cols-3 border-y border-navy max-sm:grid-cols-1">
              <div className="flex flex-col gap-1.5 border-r border-line py-[17px] pr-5 first:pl-0 last:border-r-0 max-sm:border-r-0 max-sm:border-b max-sm:border-line max-sm:py-[13px] max-sm:last:border-b-0">
                <small className="text-[9px] text-muted uppercase">Verified goals</small>
                <strong className="font-mono text-[17px]">
                  {dashboard.goals.length.toString().padStart(2, '0')}
                </strong>
              </div>
              <div className="flex flex-col gap-1.5 border-r border-line px-5 py-[17px] last:border-r-0 max-sm:border-r-0 max-sm:border-b max-sm:border-line max-sm:px-0 max-sm:py-[13px]">
                <small className="text-[9px] text-muted uppercase">PRE funded</small>
                <strong className="font-mono text-[17px]">
                  {pre ? formatAmount(pre.funded, 'PRE') : '-'}
                </strong>
              </div>
              <div className="flex flex-col gap-1.5 px-5 py-[17px] max-sm:px-0 max-sm:py-[13px]">
                <small className="text-[9px] text-muted uppercase">USDC funded</small>
                <strong className="font-mono text-[17px]">
                  {usdc ? formatAmount(usdc.funded, 'USDC') : '-'}
                </strong>
              </div>
            </div>
            <GoalList goals={dashboard.goals.slice(0, 3)} month={dashboard.month} />
            {dashboard.goals.length > 3 ? (
              <Link
                className="mt-[18px] inline-flex items-center justify-end gap-1.5 font-bold text-blue"
                href="/funding"
              >
                View all verified goals <ArrowUpRight size={15} />
              </Link>
            ) : null}
          </>
        ) : (
          <div
            className="border-y border-navy py-8"
            data-testid="funding-indexer-unavailable"
            role="status"
          >
            <strong className="text-base">Verified funding data is temporarily unavailable.</strong>
            <p className="mt-2 mb-0 max-w-2xl text-muted">
              The chain indexer is catching up. Community discussions and proposals remain available
              while fresh funding proof is rebuilt.
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
