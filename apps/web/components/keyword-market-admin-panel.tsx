'use client';

import type {
  AdAdminAuditView,
  AdAdminReportGroup,
  AdAdminRevisionView,
  AdCreativeStatusCode,
} from '@precommunity/shared';
import {
  CircleAlert,
  ExternalLink,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  WalletCards,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { AUTH_CHANGED_EVENT, AUTH_SIGN_IN_REQUESTED_EVENT } from '@/lib/auth-events';
import {
  getAdAdminAudit,
  getAdAdminReports,
  getAdAdminRevisions,
  moderateAdRevision,
  resolveAdReports,
} from '@/lib/keyword-market-api';
import { ApiError } from '@/lib/http';
import { ActionButton } from './action-button';
import { KeywordMarketCreativePreview } from './keyword-market-creative-preview';

const creativeFilters: AdCreativeStatusCode[] = [
  'PENDING_REVIEW',
  'APPROVED',
  'REJECTED',
  'SUSPENDED',
  'SUPERSEDED',
];
const reportFilters = ['OPEN', 'DISMISSED', 'ACTIONED'] as const;

function compact(value: string) {
  return value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value;
}

function AdReviewEvidence({ revision }: { revision: AdAdminRevisionView }) {
  return (
    <div className="keyword-market-review-evidence">
      <a
        className="keyword-market-review-destination"
        href={revision.destinationUrl}
        target="_blank"
        rel="noopener noreferrer"
      >
        <span>Exact destination</span>
        <strong>{revision.destinationUrl}</strong>
        <ExternalLink size={14} aria-hidden="true" />
      </a>
      <dl>
        <div>
          <dt>Status</dt>
          <dd>{revision.status.replaceAll('_', ' ')}</dd>
        </div>
        <div>
          <dt>Reports</dt>
          <dd>{revision.reportCount}</dd>
        </div>
        <div>
          <dt>30 days</dt>
          <dd>{revision.last30DaysResolutions}</dd>
        </div>
        <div>
          <dt>Lifetime</dt>
          <dd>{revision.lifetimeResolutions}</dd>
        </div>
      </dl>
      {revision.proof ? (
        <details className="keyword-market-review-proof">
          <summary>Full chain proof</summary>
          <dl>
            <div>
              <dt>Chain</dt>
              <dd>{revision.proof.chainId}</dd>
            </div>
            <div>
              <dt>Contract</dt>
              <dd>{revision.proof.contractAddress}</dd>
            </div>
            <div>
              <dt>Staker</dt>
              <dd>{revision.proof.stakerAddress}</dd>
            </div>
            <div>
              <dt>Stake</dt>
              <dd>{revision.proof.stakeRaw}</dd>
            </div>
            <div>
              <dt>Position block</dt>
              <dd>{revision.proof.positionBlock}</dd>
            </div>
            <div>
              <dt>Transaction</dt>
              <dd>{revision.proof.positionTxHash}</dd>
            </div>
            <div>
              <dt>Indexed through</dt>
              <dd>{revision.proof.indexedThroughBlock ?? 'Syncing'}</dd>
            </div>
          </dl>
        </details>
      ) : (
        <p className="keyword-market-review-no-proof">No active on-chain position.</p>
      )}
    </div>
  );
}

export function KeywordMarketAdminPanel() {
  const [revisions, setRevisions] = useState<AdAdminRevisionView[]>([]);
  const [reports, setReports] = useState<AdAdminReportGroup[]>([]);
  const [audit, setAudit] = useState<AdAdminAuditView[]>([]);
  const [creativeFilter, setCreativeFilter] = useState<AdCreativeStatusCode>('PENDING_REVIEW');
  const [reportFilter, setReportFilter] = useState<(typeof reportFilters)[number]>('OPEN');
  const [reportCursor, setReportCursor] = useState<string | null>(null);
  const [loadingMoreReports, setLoadingMoreReports] = useState(false);
  const [state, setState] = useState<'loading' | 'ready' | 'signed-out' | 'denied' | 'error'>(
    'loading',
  );
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setState('loading');
    setError('');
    try {
      const [creativeQueue, reportQueue, auditTrail] = await Promise.all([
        getAdAdminRevisions(creativeFilter),
        getAdAdminReports(reportFilter),
        getAdAdminAudit(),
      ]);
      setRevisions(creativeQueue);
      setReports(reportQueue.items);
      setReportCursor(reportQueue.nextCursor);
      setAudit(auditTrail);
      setState('ready');
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 401) setState('signed-out');
      else if (reason instanceof ApiError && reason.status === 403) setState('denied');
      else {
        setError(
          reason instanceof Error ? reason.message : 'Moderation queues could not be loaded.',
        );
        setState('error');
      }
    }
  }, [creativeFilter, reportFilter]);

  async function loadMoreReports() {
    if (!reportCursor || loadingMoreReports) return;
    setLoadingMoreReports(true);
    setError('');
    try {
      const page = await getAdAdminReports(reportFilter, reportCursor);
      setReports((current) => [...current, ...page.items]);
      setReportCursor(page.nextCursor);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'More report groups could not be loaded.',
      );
    } finally {
      setLoadingMoreReports(false);
    }
  }

  useEffect(() => {
    void load();
    const refresh = () => void load();
    window.addEventListener(AUTH_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(AUTH_CHANGED_EVENT, refresh);
  }, [load]);

  async function moderate(
    revisionId: string,
    action: 'APPROVE' | 'REJECT' | 'SUSPEND' | 'RESTORE',
  ) {
    setBusy(`${revisionId}:${action}`);
    setError('');
    try {
      await moderateAdRevision(revisionId, action, notes[revisionId]?.trim() || undefined);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Moderation action failed.');
    } finally {
      setBusy('');
    }
  }

  async function resolveReportsFor(revisionId: string, action: 'DISMISS' | 'SUSPEND_AD') {
    setBusy(`${revisionId}:${action}`);
    setError('');
    try {
      await resolveAdReports(revisionId, action, notes[revisionId]?.trim() || undefined);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Report action failed.');
    } finally {
      setBusy('');
    }
  }

  return (
    <main className="keyword-market-app-shell keyword-market-admin-shell">
      {state === 'ready' ? (
        <header className="keyword-market-page-heading">
          <div>
            <span className="keyword-market-eyebrow">CONTENT_ADMIN · SUPER_ADMIN</span>
            <h1>Ad moderation.</h1>
            <p>
              Review immutable creative versions and resolve reports against the exact revision.
            </p>
          </div>
          <ActionButton icon={<RefreshCw size={15} />} onClick={() => void load()}>
            Refresh queues
          </ActionButton>
        </header>
      ) : null}

      {error ? <div className="keyword-market-inline-error">{error}</div> : null}
      {state !== 'ready' ? (
        <div
          className={`keyword-market-access-state ${state === 'error' || state === 'denied' ? 'keyword-market-error-state' : ''}`}
        >
          {state === 'loading' ? <LoaderCircle className="animate-spin" /> : null}
          {state === 'signed-out' ? <WalletCards /> : null}
          {state === 'denied' || state === 'error' ? <CircleAlert /> : null}
          <strong>
            {state === 'loading'
              ? 'Checking workspace access…'
              : state === 'signed-out'
                ? 'Authorized wallet required'
                : state === 'denied'
                  ? 'This wallet does not have access'
                  : 'Restricted workspace unavailable'}
          </strong>
          {state === 'signed-out' ? (
            <ActionButton
              variant="primary"
              onClick={() => window.dispatchEvent(new Event(AUTH_SIGN_IN_REQUESTED_EVENT))}
            >
              Connect and sign in
            </ActionButton>
          ) : null}
        </div>
      ) : null}

      {state === 'ready' ? (
        <>
          <section className="keyword-market-admin-section">
            <header className="keyword-market-admin-section-heading">
              <div>
                <span className="keyword-market-eyebrow">Creative queue</span>
                <h2>Immutable revisions</h2>
              </div>
              <label className="keyword-market-filter-control">
                <span>Status</span>
                <select
                  value={creativeFilter}
                  onChange={(event) =>
                    setCreativeFilter(event.target.value as AdCreativeStatusCode)
                  }
                >
                  {creativeFilters.map((status) => (
                    <option key={status}>{status}</option>
                  ))}
                </select>
              </label>
            </header>
            {revisions.length ? (
              revisions.map((revision) => (
                <article className="keyword-market-moderation-row" key={revision.id}>
                  <div className="keyword-market-moderation-index">
                    <span>v{revision.version}</span>
                    <strong>{revision.keyword}</strong>
                    <small>{compact(revision.advertiserAddress)}</small>
                  </div>
                  <KeywordMarketCreativePreview creative={revision} keyword={revision.keyword} />
                  <div className="keyword-market-moderation-evidence">
                    <AdReviewEvidence revision={revision} />
                    <textarea
                      maxLength={500}
                      placeholder="Moderator note"
                      value={notes[revision.id] ?? ''}
                      onChange={(event) =>
                        setNotes((current) => ({ ...current, [revision.id]: event.target.value }))
                      }
                    />
                    <div className="keyword-market-moderation-actions">
                      {revision.status === 'PENDING_REVIEW' ? (
                        <>
                          <ActionButton
                            variant="primary"
                            onClick={() => void moderate(revision.id, 'APPROVE')}
                            disabled={Boolean(busy)}
                          >
                            Approve
                          </ActionButton>
                          <ActionButton
                            variant="danger"
                            onClick={() => void moderate(revision.id, 'REJECT')}
                            disabled={Boolean(busy)}
                          >
                            Reject
                          </ActionButton>
                        </>
                      ) : null}
                      {revision.status === 'APPROVED' ? (
                        <ActionButton
                          variant="danger"
                          onClick={() => void moderate(revision.id, 'SUSPEND')}
                          disabled={Boolean(busy)}
                        >
                          Suspend
                        </ActionButton>
                      ) : null}
                      {revision.status === 'SUSPENDED' ? (
                        <ActionButton
                          variant="primary"
                          onClick={() => void moderate(revision.id, 'RESTORE')}
                          disabled={Boolean(busy)}
                        >
                          Restore
                        </ActionButton>
                      ) : null}
                      {busy.startsWith(revision.id) ? (
                        <LoaderCircle className="animate-spin" size={16} />
                      ) : null}
                    </div>
                  </div>
                </article>
              ))
            ) : (
              <div className="keyword-market-empty-state">
                <ShieldCheck />
                <strong>No revisions in this queue</strong>
              </div>
            )}
          </section>

          <section className="keyword-market-admin-section">
            <header className="keyword-market-admin-section-heading">
              <div>
                <span className="keyword-market-eyebrow">User reports</span>
                <h2>Grouped by revision</h2>
              </div>
              <label className="keyword-market-filter-control">
                <span>Status</span>
                <select
                  value={reportFilter}
                  onChange={(event) =>
                    setReportFilter(event.target.value as (typeof reportFilters)[number])
                  }
                >
                  {reportFilters.map((status) => (
                    <option key={status}>{status}</option>
                  ))}
                </select>
              </label>
            </header>
            {reports.length ? (
              reports.map((group) => (
                <article className="keyword-market-report-group" key={group.revision.id}>
                  <div className="keyword-market-report-summary">
                    <span className="keyword-market-report-count">{group.matchingReportCount}</span>
                    <div>
                      <strong>{group.revision.keyword}</strong>
                      <small>
                        creative v{group.revision.version} ·{' '}
                        {compact(group.revision.advertiserAddress)}
                      </small>
                    </div>
                    <KeywordMarketCreativePreview
                      creative={group.revision}
                      keyword={group.revision.keyword}
                    />
                  </div>
                  <div className="keyword-market-report-evidence">
                    <AdReviewEvidence revision={group.revision} />
                  </div>
                  <div className="keyword-market-report-items">
                    {group.reports.map((report) => (
                      <div key={report.id}>
                        <span>{report.reason.replaceAll('_', ' ')}</span>
                        <p>{report.comment || 'No comment supplied.'}</p>
                        <small>{new Date(report.createdAt).toLocaleString('en-GB')}</small>
                      </div>
                    ))}
                  </div>
                  {group.reportsTruncated ? (
                    <p className="keyword-market-report-preview-note">
                      Showing the {group.reports.length} newest reports from this revision.
                    </p>
                  ) : null}
                  <div className="keyword-market-report-resolution">
                    <textarea
                      maxLength={500}
                      placeholder="Resolution note"
                      value={notes[group.revision.id] ?? ''}
                      onChange={(event) =>
                        setNotes((current) => ({
                          ...current,
                          [group.revision.id]: event.target.value,
                        }))
                      }
                    />
                    <div>
                      <ActionButton
                        onClick={() => void resolveReportsFor(group.revision.id, 'DISMISS')}
                        disabled={Boolean(busy)}
                      >
                        Dismiss reports
                      </ActionButton>
                      <ActionButton
                        variant="danger"
                        onClick={() => void resolveReportsFor(group.revision.id, 'SUSPEND_AD')}
                        disabled={Boolean(busy)}
                      >
                        Suspend ad + close
                      </ActionButton>
                      {busy.startsWith(group.revision.id) ? (
                        <LoaderCircle className="animate-spin" size={16} />
                      ) : null}
                    </div>
                  </div>
                </article>
              ))
            ) : (
              <div className="keyword-market-empty-state">
                <ShieldCheck />
                <strong>No report groups in this queue</strong>
              </div>
            )}
            {reportCursor ? (
              <div className="keyword-market-admin-pagination">
                <ActionButton
                  onClick={() => void loadMoreReports()}
                  disabled={loadingMoreReports}
                  icon={
                    loadingMoreReports ? (
                      <LoaderCircle className="animate-spin" size={15} />
                    ) : undefined
                  }
                >
                  {loadingMoreReports ? 'Loading…' : 'Load more report groups'}
                </ActionButton>
              </div>
            ) : null}
          </section>

          <section className="keyword-market-admin-section">
            <header className="keyword-market-admin-section-heading">
              <div>
                <span className="keyword-market-eyebrow">Immutable operations log</span>
                <h2>Moderation audit trail</h2>
              </div>
              <span className="keyword-market-audit-total">{audit.length} recorded actions</span>
            </header>
            {audit.length ? (
              <div className="keyword-market-audit-list">
                <div className="keyword-market-audit-head">
                  <span>Time</span>
                  <span>Action / revision</span>
                  <span>Actor</span>
                  <span>Recorded transition</span>
                </div>
                {audit.map((event) => (
                  <div className="keyword-market-audit-row" key={event.id}>
                    <time dateTime={event.createdAt}>
                      {new Date(event.createdAt).toLocaleString('en-GB')}
                    </time>
                    <span>
                      <strong>{event.action.replaceAll('_', ' ')}</strong>
                      <small>{compact(event.entityId)}</small>
                    </span>
                    <span title={event.actorAddress ?? undefined}>
                      {event.actorAddress ? compact(event.actorAddress) : 'System'}
                    </span>
                    <details>
                      <summary>Inspect before / after</summary>
                      <pre>
                        {JSON.stringify({ before: event.before, after: event.after }, null, 2)}
                      </pre>
                    </details>
                  </div>
                ))}
              </div>
            ) : (
              <div className="keyword-market-empty-state">
                <ShieldCheck />
                <strong>No moderation actions recorded</strong>
              </div>
            )}
          </section>
        </>
      ) : null}
    </main>
  );
}
