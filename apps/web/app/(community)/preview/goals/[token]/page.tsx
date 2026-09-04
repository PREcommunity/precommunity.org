import type { Metadata } from 'next';
import { ExternalLink } from 'lucide-react';
import { notFound, redirect } from 'next/navigation';
import { FundingMeter } from '@/components/funding-meter';
import { getGoalPreview } from '@/lib/api';
import { formatDeadline } from '@/lib/format';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Funding request preview',
  description: 'An unpublished funding request shared for review.',
  robots: { index: false, follow: false, noarchive: true },
  referrer: 'no-referrer',
  alternates: { canonical: null },
  openGraph: null,
  twitter: null,
};

export default async function GoalPreviewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const preview = await getGoalPreview(token);
  if (!preview) notFound();
  if (preview.kind === 'published') redirect(`/goals/${encodeURIComponent(preview.slug)}`);
  const draft = preview.draft;
  const monthly = draft.cadence === 'MONTHLY';
  const hasSupportingMaterial = Boolean(
    draft.discussionUrl || draft.metadataUri || draft.documents.length,
  );

  return (
    <main className="page-gutter pt-7 pb-[60px]">
      <aside className="border-l-2 border-blue bg-blue-soft px-4 py-3" aria-label="Preview status">
        <strong className="text-sm">Draft preview — not published</strong>
        <p className="mb-0 mt-1 text-xs text-muted">
          This is the latest saved version, shared for feedback. Funding is not open.
          {draft.status === 'PENDING_CHAIN'
            ? ' Publication is awaiting blockchain confirmation.'
            : ''}
        </p>
      </aside>

      <section className="py-9" aria-labelledby="preview-targets">
        <span className="font-mono text-[11px] tracking-[.05em] text-blue uppercase">
          {monthly ? 'Monthly request' : 'One-time request'}
        </span>
        <h2 id="preview-targets" className="mt-1.5 mb-5 text-2xl leading-[1.15] tracking-[-.025em]">
          Proposed funding targets
        </h2>
        <div className="grid grid-cols-2 gap-8 max-sm:grid-cols-1">
          {draft.targets.map((target) => (
            <FundingMeter
              key={target.asset}
              item={{
                asset: target.asset,
                target: target.amount,
                funded: '0',
                released: '0',
                surplus: '0',
                percent: 0,
              }}
            />
          ))}
        </div>
      </section>

      <section className="border-b border-navy py-7">
        <span className="font-mono text-[11px] tracking-[.05em] text-blue uppercase">
          {draft.subproject?.name ?? 'Funding request'}
          {draft.category ? ` · ${draft.category}` : ''}
        </span>
        <h1 className="mt-2.5 mb-2 text-[clamp(30px,4vw,42px)] leading-[1.05] tracking-[-.04em]">
          {draft.title}
        </h1>
        <p className="m-0 max-w-[760px] whitespace-pre-wrap text-muted">
          {draft.description || 'No description.'}
        </p>
      </section>

      <dl className="m-0 grid grid-cols-2 gap-x-10 border-b border-line max-sm:grid-cols-1">
        <div className="flex flex-col gap-1.5 py-4">
          <dt className="text-[9px] text-muted uppercase">Cadence</dt>
          <dd className="m-0 text-xs font-bold">{monthly ? 'Monthly' : 'One-time'}</dd>
        </div>
        <div className="flex flex-col gap-1.5 py-4">
          <dt className="text-[9px] text-muted uppercase">Recipient</dt>
          <dd className="m-0 break-all font-mono text-xs">{draft.recipientAddress}</dd>
        </div>
        <div className="flex flex-col gap-1.5 py-4">
          <dt className="text-[9px] text-muted uppercase">
            {monthly ? 'First settlement · UTC' : 'Deadline · UTC'}
          </dt>
          <dd className="m-0 text-xs font-bold">
            {monthly
              ? draft.firstSettlementAt
                ? formatDeadline(draft.firstSettlementAt)
                : 'Same day next month after publication, at 00:00 UTC'
              : draft.deadline
                ? formatDeadline(draft.deadline)
                : 'Not set'}
          </dd>
          {monthly ? (
            <dd className="m-0 text-xs text-muted">
              Repeats monthly. Shorter months use their final day, then return to the original day.
            </dd>
          ) : null}
        </div>
        {monthly ? (
          <div className="flex flex-col gap-1.5 py-4">
            <dt className="text-[9px] text-muted uppercase">Monthly surplus policy</dt>
            <dd className="m-0 text-xs font-bold">
              {draft.monthlySurplusPolicy === 'PAYOUT_ALL' ? 'Payout all' : 'Roll over'}
            </dd>
            <dd className="m-0 max-w-[65ch] text-xs text-muted">
              {draft.monthlySurplusPolicy === 'PAYOUT_ALL'
                ? 'The full period balance becomes payable to the recipient.'
                : 'Up to the monthly target becomes payable; the excess moves to the next month.'}{' '}
              Settlement records these amounts; payout is separate.
            </dd>
          </div>
        ) : null}
      </dl>

      {hasSupportingMaterial ? (
        <section className="py-9" aria-labelledby="preview-material">
          <h2 id="preview-material" className="mt-0 text-2xl leading-[1.15] tracking-[-.025em]">
            Supporting material
          </h2>
          <p className="m-0 text-muted">Links attached to this draft.</p>
          <div className="mt-4 flex flex-wrap gap-3.5">
            {draft.discussionUrl ? (
              <a
                className="inline-flex items-center gap-1.5 text-xs text-blue"
                href={draft.discussionUrl}
                target="_blank"
                rel="noreferrer"
              >
                Discussion <ExternalLink size={14} />
              </a>
            ) : null}
            {draft.metadataUri ? (
              <a
                className="inline-flex items-center gap-1.5 text-xs text-blue"
                href={`https://ipfs.io/ipfs/${draft.metadataUri.slice(7)}`}
                target="_blank"
                rel="noreferrer"
              >
                IPFS reference <ExternalLink size={14} />
              </a>
            ) : null}
            {draft.documents.map((document) => (
              <a
                className="inline-flex items-center gap-1.5 text-xs text-blue"
                href={document.url}
                target="_blank"
                rel="noreferrer"
                key={`${document.label}-${document.url}`}
              >
                {document.label} <ExternalLink size={14} />
              </a>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}
