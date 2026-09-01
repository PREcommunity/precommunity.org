import Link from 'next/link';
import {
  ArrowLeft,
  ExternalLink,
  MessagesSquare,
  MessageSquareText,
  UserRound,
  Vote,
} from 'lucide-react';
import { notFound } from 'next/navigation';
import { getCommunityProfile } from '@/lib/api';

export default async function CommunityProfilePage({
  params,
}: {
  params: Promise<{ address: string }>;
}) {
  const { address } = await params;
  const data = await getCommunityProfile(address);
  if (!data) notFound();
  const name = data.profile?.displayName || `${data.address.slice(0, 6)}…${data.address.slice(-4)}`;
  return (
    <main className="min-h-[70vh] px-[var(--page-pad)] pt-7 pb-[60px]">
      <Link href="/community" className="inline-flex items-center gap-1.5 text-xs text-blue">
        <ArrowLeft size={16} /> Back to community
      </Link>
      <section className="grid grid-cols-[96px_minmax(0,1fr)] gap-6 border-b border-line py-7 max-sm:grid-cols-[64px_minmax(0,1fr)] max-sm:gap-3.5">
        <div className="grid size-[88px] place-items-center overflow-hidden rounded-full bg-blue-soft max-sm:size-14">
          {data.profile?.avatarUrl ? (
            <img className="size-full object-cover" src={data.profile.avatarUrl} alt="" />
          ) : (
            <UserRound size={42} />
          )}
        </div>
        <div>
          <span className="font-mono text-[11px] tracking-[.05em] text-blue uppercase">
            {data.profile
              ? `Community profile · revision ${data.profile.revision}`
              : 'Community member'}
          </span>
          <h1 className="mt-2.5 mb-2 text-[clamp(30px,4vw,42px)] leading-[1.05] tracking-[-.04em]">
            {name}
          </h1>
          <code className="break-all text-[9px] text-muted">{data.address}</code>
          <p className="max-w-[680px]">
            {data.profile?.bio || (data.profile ? 'No public bio yet.' : 'No public profile yet.')}
          </p>
          <div className="mt-4 flex flex-wrap gap-3.5">
            {data.profile?.websiteUrl ? (
              <a
                className="inline-flex items-center gap-1.5 break-all text-xs text-blue transition-transform duration-150 hover:translate-x-0.5"
                href={data.profile.websiteUrl}
                target="_blank"
                rel="noreferrer"
              >
                <span>{data.profile.websiteUrl}</span>
                <ExternalLink className="shrink-0" size={13} />
              </a>
            ) : null}
          </div>
        </div>
      </section>
      <section className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-6 pt-7 max-[900px]:grid-cols-2 max-sm:grid-cols-1">
        <div>
          <header className="flex justify-between border-b border-navy pb-[7px]">
            <span>Forum</span>
            <MessagesSquare size={18} />
          </header>
          {data.forumTopics.length || data.forumReplies.length ? (
            <>
              {data.forumTopics.slice(0, 5).map((topic) => (
                <Link
                  className="flex flex-col border-b border-line py-2.5 transition-transform duration-180 hover:translate-x-1"
                  href={`/community/forum/${topic.slug}`}
                  key={`topic-${topic.slug}`}
                >
                  <small className="text-[9px] text-blue uppercase">
                    Topic · {topic.category.replaceAll('_', ' ')}
                  </small>
                  <strong>{topic.title}</strong>
                </Link>
              ))}
              {data.forumReplies.slice(0, 5).map((reply) => (
                <Link
                  className="flex flex-col border-b border-line py-2.5 transition-transform duration-180 hover:translate-x-1"
                  href={`/community/forum/${reply.topic.slug}`}
                  key={`reply-${reply.id}`}
                >
                  <small className="text-[9px] text-blue uppercase">
                    Response · {reply.topic.title ?? 'Unavailable opening post'}
                  </small>
                  <strong>{reply.body}</strong>
                </Link>
              ))}
            </>
          ) : (
            <p className="text-muted">No forum activity.</p>
          )}
        </div>
        <div>
          <header className="flex justify-between border-b border-navy pb-[7px]">
            <span>Proposals</span>
            <strong>{data.proposals.length}</strong>
          </header>
          {data.proposals.length ? (
            data.proposals.map((proposal) => (
              <Link
                className="flex flex-col border-b border-line py-2.5 transition-transform duration-180 hover:translate-x-1"
                href={`/community/proposals/${proposal.slug}`}
                key={proposal.slug}
              >
                <small className="text-[9px] text-blue uppercase">
                  {proposal.status.replaceAll('_', ' ')}
                </small>
                <strong>{proposal.title}</strong>
              </Link>
            ))
          ) : (
            <p className="text-muted">No proposals.</p>
          )}
        </div>
        <div>
          <header className="flex justify-between border-b border-navy pb-[7px]">
            <span>Proposal discussion</span>
            <MessageSquareText size={18} />
          </header>
          {data.comments.length ? (
            data.comments.map((comment) => (
              <Link
                className="flex flex-col border-b border-line py-2.5 transition-transform duration-180 hover:translate-x-1"
                href={`/community/proposals/${comment.proposal.slug}`}
                key={comment.id}
              >
                <small className="text-[9px] text-blue uppercase">{comment.proposal.title}</small>
                <strong>{comment.body}</strong>
              </Link>
            ))
          ) : (
            <p className="text-muted">No comments.</p>
          )}
        </div>
        <div>
          <header className="flex justify-between border-b border-navy pb-[7px]">
            <span>Votes</span>
            <Vote size={18} />
          </header>
          {data.votes.length ? (
            data.votes.map((vote, index) => (
              <Link
                className="flex flex-col border-b border-line py-2.5 transition-transform duration-180 hover:translate-x-1"
                href={`/community/proposals/${vote.proposal.slug}`}
                key={`${vote.proposal.slug}-${index}`}
              >
                <small className="text-[9px] text-blue uppercase">{vote.choice}</small>
                <strong>{vote.proposal.title}</strong>
              </Link>
            ))
          ) : (
            <p className="text-muted">No votes.</p>
          )}
        </div>
      </section>
    </main>
  );
}
