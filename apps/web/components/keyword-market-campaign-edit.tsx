'use client';

import type { AdCampaignView } from '@precommunity/shared';
import { ArrowLeft, CircleAlert, LoaderCircle, WalletCards } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AUTH_CHANGED_EVENT, AUTH_SIGN_IN_REQUESTED_EVENT } from '@/lib/auth-events';
import { ApiError } from '@/lib/http';
import { getMyAdCampaigns } from '@/lib/keyword-market-api';
import { ActionButton } from './action-button';
import { KeywordMarketCampaignForm } from './keyword-market-campaign-form';

export function KeywordMarketCampaignEdit({ campaignId }: { campaignId: string }) {
  const [campaign, setCampaign] = useState<AdCampaignView | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'signed-out' | 'missing' | 'error'>(
    'loading',
  );
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    let request = 0;
    async function load() {
      const currentRequest = ++request;
      setState('loading');
      setError('');
      try {
        const campaigns = await getMyAdCampaigns();
        if (!active || currentRequest !== request) return;
        const selected = campaigns.find((item) => item.id === campaignId) ?? null;
        setCampaign(selected);
        setState(selected ? 'ready' : 'missing');
      } catch (reason) {
        if (!active || currentRequest !== request) return;
        setCampaign(null);
        if (reason instanceof ApiError && reason.status === 401) {
          setState('signed-out');
        } else {
          setError(reason instanceof Error ? reason.message : 'Campaign could not be loaded.');
          setState('error');
        }
      }
    }
    const refresh = () => void load();
    void load();
    window.addEventListener(AUTH_CHANGED_EVENT, refresh);
    return () => {
      active = false;
      window.removeEventListener(AUTH_CHANGED_EVENT, refresh);
    };
  }, [campaignId]);

  return (
    <>
      {/* Keep the draft mounted while rechecking campaign ownership after sign-in. */}
      {campaign ? (
        <div hidden={state !== 'ready'}>
          <KeywordMarketCampaignForm key={campaign.id} campaign={campaign} />
        </div>
      ) : null}
      {state !== 'ready' ? (
        <main className="keyword-market-app-shell">
          <Link
            className="keyword-market-back-link"
            href={`/keyword-market/campaigns/${campaignId}`}
          >
            <ArrowLeft size={14} /> Campaign
          </Link>
          <div
            className={`keyword-market-access-state ${state === 'error' ? 'keyword-market-error-state' : ''}`}
          >
            {state === 'loading' ? <LoaderCircle className="animate-spin" /> : null}
            {state === 'signed-out' ? <WalletCards /> : null}
            {state === 'missing' || state === 'error' ? <CircleAlert /> : null}
            <strong>
              {state === 'loading'
                ? 'Loading campaign…'
                : state === 'signed-out'
                  ? 'Sign in with the campaign wallet'
                  : state === 'missing'
                    ? 'Campaign not found'
                    : 'Campaign unavailable'}
            </strong>
            {error ? <p>{error}</p> : null}
            {state === 'signed-out' ? (
              <ActionButton
                variant="primary"
                onClick={() => window.dispatchEvent(new Event(AUTH_SIGN_IN_REQUESTED_EVENT))}
              >
                Connect and sign in
              </ActionButton>
            ) : null}
          </div>
        </main>
      ) : null}
    </>
  );
}
