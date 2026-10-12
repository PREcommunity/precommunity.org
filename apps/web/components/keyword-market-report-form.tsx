'use client';

import { AD_REPORT_REASONS, type AdReportReasonCode } from '@precommunity/shared';
import { useRef, useState, type FormEvent } from 'react';
import { reportAd } from '@/lib/keyword-market-api';
import { ActionButton } from './action-button';

const reasonLabels: Record<AdReportReasonCode, string> = {
  SCAM_PHISHING: 'Scam or phishing',
  MISLEADING: 'Misleading content',
  INAPPROPRIATE: 'Inappropriate content',
  BROKEN_LINK: 'Broken link',
  OTHER: 'Other',
};

export function KeywordMarketReportForm({ revisionId }: { revisionId: string }) {
  const [reason, setReason] = useState<AdReportReasonCode | ''>('');
  const [comment, setComment] = useState('');
  const [pending, setPending] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current || submitted) return;
    if (!reason || !AD_REPORT_REASONS.includes(reason)) {
      setError('Choose a reason for your report.');
      return;
    }
    const trimmedComment = comment.trim();
    if (trimmedComment.length > 500) {
      setError('Keep your comment to 500 characters or fewer.');
      return;
    }
    submitting.current = true;
    setPending(true);
    setError('');
    try {
      await reportAd(revisionId, {
        reason,
        ...(trimmedComment ? { comment: trimmedComment } : {}),
      });
      setSubmitted(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Your report could not be submitted.');
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  return (
    <main className="keyword-market-app-shell">
      <div className="max-w-xl">
        <header className="keyword-market-page-heading keyword-market-page-heading-compact">
          <div>
            <span className="keyword-market-eyebrow">Keyword Market</span>
            <h1>Report an ad.</h1>
            <p>Tell us what is wrong with this ad so our moderation team can review it.</p>
          </div>
        </header>
        {submitted ? (
          <div className="border border-line bg-blue-soft p-5" role="status">
            <strong>Report submitted for review.</strong>
            <p className="mt-2 text-muted">Thank you. You can close this page.</p>
          </div>
        ) : (
          <form className="keyword-market-report-form" onSubmit={submit}>
            <label className="keyword-market-field">
              <span>Reason</span>
              <select
                required
                value={reason}
                onChange={(event) => setReason(event.target.value as AdReportReasonCode | '')}
                disabled={pending}
              >
                <option value="" disabled>
                  Choose a reason
                </option>
                {AD_REPORT_REASONS.map((code) => (
                  <option key={code} value={code}>
                    {reasonLabels[code]}
                  </option>
                ))}
              </select>
            </label>
            <label className="keyword-market-field">
              <span>Comment (optional)</span>
              <textarea
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                maxLength={500}
                disabled={pending}
                placeholder="Add details that will help us review the ad."
              />
              <small className="text-muted">Up to 500 characters.</small>
            </label>
            {error ? (
              <div className="keyword-market-inline-error" role="alert">
                {error}
              </div>
            ) : null}
            <div className="keyword-market-form-actions">
              <ActionButton type="submit" variant="primary" disabled={pending}>
                {pending ? 'Submitting…' : 'Submit report'}
              </ActionButton>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}
