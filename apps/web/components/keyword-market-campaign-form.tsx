'use client';

import {
  AdsTextValidationError,
  normalizeAdKeyword,
  type AdCampaignView,
} from '@precommunity/shared';
import { ArrowLeft, Check, LoaderCircle, WalletCards } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AUTH_SIGN_IN_REQUESTED_EVENT } from '@/lib/auth-events';
import { createAdCampaign, createAdRevision } from '@/lib/keyword-market-api';
import { ApiError } from '@/lib/http';
import { ActionButton } from './action-button';
import { FormFieldError, useFormValidation } from './form-validation';
import { KeywordMarketCreativePreview } from './keyword-market-creative-preview';

const initialCreative = {
  keyword: '',
  headline: '',
  description: '',
  destinationUrl: '',
};

export function KeywordMarketCampaignForm({
  initialKeyword = '',
  campaign,
}: {
  initialKeyword?: string;
  campaign?: AdCampaignView;
}) {
  const router = useRouter();
  const [form, setForm] = useState(() => {
    const source = campaign?.pendingRevision ?? campaign?.activeRevision ?? campaign?.revisions[0];
    return {
      ...initialCreative,
      keyword: campaign?.keyword ?? initialKeyword,
      headline: source?.headline ?? '',
      description: source?.description ?? '',
      destinationUrl: source?.destinationUrl ?? '',
    };
  });
  const [state, setState] = useState<'idle' | 'saving' | 'signed-out' | 'saved'>('idle');
  const [error, setError] = useState('');
  const validation = useFormValidation();
  const backHref = campaign
    ? `/keyword-market/campaigns/${campaign.id}`
    : '/keyword-market/campaigns';
  const normalized = useMemo(() => {
    if (!form.keyword.trim()) return { value: '', error: '' };
    try {
      return { value: normalizeAdKeyword(form.keyword), error: '' };
    } catch (reason) {
      return {
        value: '',
        error:
          reason instanceof AdsTextValidationError
            ? reason.message
            : 'Keyword could not be normalized.',
      };
    }
  }, [form.keyword]);

  function update(name: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setState('saving');
    try {
      let campaignId = campaign?.id;
      if (campaign) {
        const { headline, description, destinationUrl } = form;
        await createAdRevision(campaign.id, { headline, description, destinationUrl });
      } else {
        const created = await createAdCampaign(form);
        campaignId = created.id;
      }
      setState('saved');
      router.push(`/keyword-market/campaigns/${campaignId}`);
      router.refresh();
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 401) {
        setState('signed-out');
        return;
      }
      setError(
        reason instanceof Error
          ? reason.message
          : campaign
            ? 'Campaign changes could not be saved.'
            : 'Campaign could not be created.',
      );
      setState('idle');
    }
  }

  return (
    <main className="keyword-market-app-shell">
      <header className="keyword-market-page-heading keyword-market-page-heading-compact">
        <div>
          <Link className="keyword-market-back-link" href={backHref}>
            <ArrowLeft size={14} /> {campaign ? 'Campaign' : 'Campaigns'}
          </Link>
          <span className="keyword-market-eyebrow">
            {campaign ? campaign.keyword : 'New campaign'}
          </span>
          <h1>{campaign ? 'Edit campaign' : 'Claim a search phrase.'}</h1>
          <p>
            {campaign
              ? 'Update your ad and save your changes. Review may be required before publication.'
              : 'Create and submit the ad now. Add a PRE deposit and a USD bid when the market is synced.'}
          </p>
        </div>
      </header>

      <form
        className="keyword-market-editor-grid"
        onSubmit={submit}
        onInvalid={validation.onInvalid}
        onInput={validation.onInput}
      >
        <section className="keyword-market-editor-fields">
          <div className="keyword-market-form-section-heading">
            <span>01</span>
            <div>
              <strong>Keyword</strong>
              <small>
                {campaign
                  ? 'The campaign keyword stays the same'
                  : '1–5 whole tokens · 64 characters'}
              </small>
            </div>
          </div>
          <label className="keyword-market-field">
            <span>Search phrase</span>
            <input
              {...validation.fieldProps('keyword')}
              value={form.keyword}
              onChange={(event) => update('keyword', event.target.value)}
              maxLength={256}
              placeholder="bitcoin"
              required
              readOnly={Boolean(campaign)}
              autoFocus={!campaign}
            />
            <FormFieldError {...validation.errorProps('keyword')} />
          </label>
          <div className={`keyword-market-normalized-keyword ${normalized.error ? 'invalid' : ''}`}>
            <span>Normalized</span>
            <strong>{normalized.value || normalized.error || '—'}</strong>
          </div>

          <div className="keyword-market-form-section-heading">
            <span>02</span>
            <div>
              <strong>Creative</strong>
              <small>Each submission creates a new immutable revision</small>
            </div>
          </div>
          <label className="keyword-market-field">
            <span>
              Headline <small>{form.headline.length}/60</small>
            </span>
            <input
              autoFocus={Boolean(campaign)}
              value={form.headline}
              onChange={(event) => update('headline', event.target.value)}
              maxLength={60}
              placeholder="A useful result for this query"
            />
          </label>
          <label className="keyword-market-field">
            <span>
              Description <small>{form.description.length}/160</small>
            </span>
            <textarea
              {...validation.fieldProps('description')}
              value={form.description}
              onChange={(event) => update('description', event.target.value)}
              maxLength={160}
              placeholder="Explain what the searcher will find after opening the result."
              required
            />
            <FormFieldError {...validation.errorProps('description')} />
          </label>
          <label className="keyword-market-field">
            <span>
              HTTPS destination <small>{form.destinationUrl.length}/2048</small>
            </span>
            <input
              {...validation.fieldProps('destinationUrl')}
              type="url"
              inputMode="url"
              value={form.destinationUrl}
              onChange={(event) => update('destinationUrl', event.target.value)}
              maxLength={2048}
              pattern="https://.*"
              placeholder="https://example.com/landing"
              required
            />
            <FormFieldError {...validation.errorProps('destinationUrl')} />
          </label>
          {error ? <div className="keyword-market-inline-error">{error}</div> : null}
          {state === 'signed-out' ? (
            <div className="keyword-market-auth-prompt">
              <WalletCards size={18} />
              <span>
                {campaign
                  ? 'Sign in with the campaign wallet to save your changes.'
                  : 'Sign in with the wallet that will own this campaign.'}
              </span>
              <ActionButton
                type="button"
                onClick={() => window.dispatchEvent(new Event(AUTH_SIGN_IN_REQUESTED_EVENT))}
              >
                Sign in
              </ActionButton>
            </div>
          ) : null}
          <div className="keyword-market-form-actions">
            <ActionButton
              type="submit"
              variant="primary"
              disabled={state === 'saving' || Boolean(normalized.error)}
              icon={
                state === 'saving' ? (
                  <LoaderCircle className="animate-spin" size={15} />
                ) : state === 'saved' ? (
                  <Check size={15} />
                ) : undefined
              }
            >
              {state === 'saving'
                ? campaign
                  ? 'Saving…'
                  : 'Creating…'
                : state === 'saved'
                  ? campaign
                    ? 'Saved'
                    : 'Created'
                  : campaign
                    ? 'Save changes'
                    : 'Create and submit'}
            </ActionButton>
            <Link className="keyword-market-secondary-link" href={backHref}>
              Cancel
            </Link>
          </div>
        </section>

        <aside className="keyword-market-editor-preview">
          <span className="keyword-market-eyebrow">Live preview</span>
          <h2>Search result</h2>
          <KeywordMarketCreativePreview
            creative={form}
            keyword={normalized.value || undefined}
            placeholders
          />
          <dl className="keyword-market-editor-rules">
            <div>
              <dt>Moderation</dt>
              <dd>Review may be required before publication</dd>
            </div>
            <div>
              <dt>Campaign</dt>
              <dd>{campaign ? (campaign.paused ? 'Paused' : 'Active') : 'Not staked'}</dd>
            </div>
            <div>
              <dt>Destination</dt>
              <dd>HTTPS only</dd>
            </div>
          </dl>
        </aside>
      </form>
    </main>
  );
}
