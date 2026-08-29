import Link from 'next/link';
import { ArrowUpRight, Clock3, MessageSquareText, Vote } from 'lucide-react';
import { formatUnits } from 'viem';
import type { CommunityProposal } from '@precommunity/shared';
import { CommunityProposalForm } from './community-proposal-form';

const statusCopy: Record<CommunityProposal['status'], string> = {
  PENDING_REVIEW: 'In review',
  VOTING: 'Voting open',
  PASSED: 'Community passed',
  REJECTED: 'Not passed',
  CONVERTED: 'Goal draft created',
  DECLINED: 'Declined',
  REMOVED: 'Removed',
};

function pre(raw: string) {
  const value = formatUnits(BigInt(raw), 18);
  const [whole, decimals] = value.split('.');
  return decimals
    ? `${whole}.${decimals.slice(0, 2).replace(/0+$/, '')}`.replace(/\.$/, '')
    : whole;
}

export function CommunityFeed({
  proposals,
  activeStatus,
  activeCategory,
}: {
  proposals: CommunityProposal[];
  activeStatus?: string;
  activeCategory?: string;
}) {
  const categories = [...new Set(proposals.map((proposal) => proposal.category))];
  return (
    <main className="min-h-[70vh]">
      <section className="grid grid-cols-[minmax(0,1fr)_260px] gap-10 border-b border-line px-[var(--page-pad)] pt-10 pb-7 max-sm:grid-cols-1 max-sm:gap-6 max-sm:px-4 max-sm:pt-7 max-sm:pb-[22px]">
        <div>
          <span className="inline-flex items-center gap-1.5 font-mono text-[11px] tracking-[.05em] text-blue uppercase">
            PRE holders
          </span>
          <h1 className="mt-3 mb-2 text-[clamp(32px,4vw,46px)] leading-[1.05] tracking-[-.04em] max-sm:text-[32px]">
            Community proposals
          </h1>
          <p className="m-0 max-w-[680px] text-muted">
            Propose, discuss and vote on the next ecosystem goals.
          </p>
        </div>
        <aside className="self-end border-l border-line pl-6 max-sm:border-t max-sm:border-l-0 max-sm:px-0 max-sm:pt-4">
          <strong className="block font-mono text-[34px]">
            {proposals.length.toString().padStart(2, '0')}
          </strong>
          <span className="font-bold">community proposals</span>
          <small className="mt-1 block text-muted">
            Discussion is stored off-chain. Funding remains verified on Base.
          </small>
        </aside>
      </section>
      <section className="flex items-start justify-between gap-6 border-b border-line bg-white px-[var(--page-pad)] py-3.5 max-sm:flex-col max-sm:items-stretch">
        <div className="flex flex-col">
          <strong>Browse proposals</strong>
          <small className="text-muted">
            {categories.length ? categories.join(' · ') : 'No categories yet'}
          </small>
        </div>
        <CommunityProposalForm />
      </section>
      <nav
        className="flex items-center gap-1.5 overflow-x-auto border-b border-line px-[var(--page-pad)] py-2 max-sm:px-4"
        aria-label="Proposal filters"
      >
        <Link
          className={`shrink-0 px-[7px] py-[5px] text-[9px] font-bold text-muted uppercase hover:bg-blue-soft hover:text-navy ${!activeStatus && !activeCategory ? 'bg-blue-soft text-navy' : ''}`}
          href="/community/proposals"
        >
          All
        </Link>
        {(['VOTING', 'PASSED', 'CONVERTED'] as const).map((status) => (
          <Link
            className={`shrink-0 px-[7px] py-[5px] text-[9px] font-bold text-muted uppercase hover:bg-blue-soft hover:text-navy ${activeStatus === status ? 'bg-blue-soft text-navy' : ''}`}
            href={`/community/proposals?status=${status}`}
            key={status}
          >
            {status === 'VOTING'
              ? 'Voting now'
              : status === 'PASSED'
                ? 'Passed'
                : 'Fundable drafts'}
          </Link>
        ))}
        <span className="flex-1" />
        {categories.slice(0, 5).map((category) => (
          <Link
            className={`shrink-0 px-[7px] py-[5px] text-[9px] font-bold text-muted uppercase hover:bg-blue-soft hover:text-navy ${activeCategory === category ? 'bg-blue-soft text-navy' : ''}`}
            href={`/community/proposals?category=${encodeURIComponent(category)}`}
            key={category}
          >
            {category}
          </Link>
        ))}
        <Link
          className="shrink-0 px-[7px] py-[5px] text-[9px] font-bold text-muted uppercase hover:bg-blue-soft hover:text-navy"
          href="/community/proposals/mine"
        >
          Your submissions
        </Link>
      </nav>
      <section className="px-[var(--page-pad)] pt-2.5 pb-[60px]">
        {proposals.length ? (
          proposals.map((proposal, index) => (
            <Link
              href={`/community/proposals/${proposal.slug}`}
              className="group grid min-h-[92px] grid-cols-[24px_minmax(240px,1fr)_150px_110px_18px] items-center gap-3.5 border-b border-line transition-[padding] duration-180 hover:px-2.5 max-[900px]:grid-cols-[24px_minmax(220px,1fr)_140px_18px] max-sm:grid-cols-[20px_minmax(0,1fr)_18px] max-sm:py-3.5"
              key={proposal.id}
              style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}
            >
              <span className="font-mono text-[10px] text-blue">
                {String(index + 1).padStart(2, '0')}
              </span>
              <div className="min-w-0">
                <span className="font-mono text-[9px] text-blue uppercase">
                  {proposal.category}
                </span>
                <h2 className="my-[3px] text-[17px]">{proposal.title}</h2>
                <p className="m-0 overflow-hidden text-xs text-ellipsis whitespace-nowrap text-muted">
                  {proposal.description}
                </p>
                <small className="text-[10px] text-muted">
                  by{' '}
                  {proposal.author.displayName ||
                    `${proposal.author.address.slice(0, 6)}…${proposal.author.address.slice(-4)}`}
                </small>
              </div>
              <div className="flex flex-col max-[900px]:col-start-3 max-[900px]:row-start-1 max-sm:col-start-2 max-sm:row-auto">
                <strong
                  className={`text-[10px] uppercase before:mr-1.5 before:inline-block before:size-1.5 before:rounded-full ${proposal.status === 'VOTING' || proposal.status === 'PASSED' ? 'before:bg-success' : proposal.status === 'PENDING_REVIEW' ? 'before:bg-warning' : proposal.status === 'REJECTED' || proposal.status === 'DECLINED' || proposal.status === 'REMOVED' ? 'before:bg-danger' : 'before:bg-muted'}`}
                >
                  {statusCopy[proposal.status]}
                </strong>
                {proposal.status === 'VOTING' && proposal.votingEndsAt ? (
                  <small className="text-[10px] text-muted">
                    <Clock3 size={13} /> ends{' '}
                    {new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(
                      new Date(proposal.votingEndsAt),
                    )}
                  </small>
                ) : (
                  <small className="text-[10px] text-muted">
                    <MessageSquareText size={13} /> discuss
                  </small>
                )}
              </div>
              <div className="flex flex-col font-mono max-[900px]:col-start-2 max-sm:col-start-2">
                <Vote size={16} />
                <strong>{pre(proposal.results.forRaw)} PRE</strong>
                <small className="text-[10px] text-muted">
                  {proposal.results.voterCount} voters
                </small>
              </div>
              <ArrowUpRight
                className="text-blue transition-transform duration-180 group-hover:translate-x-1 group-hover:-translate-y-1 max-[900px]:col-start-4 max-[900px]:row-start-1 max-sm:col-start-3 max-sm:row-start-1"
                size={18}
              />
            </Link>
          ))
        ) : (
          <div className="border-y border-line py-7">
            <span className="hidden">00</span>
            <h2 className="m-0 text-lg">No proposals yet.</h2>
            <p className="text-muted">PRE holders can submit the first idea for review.</p>
          </div>
        )}
      </section>
    </main>
  );
}
