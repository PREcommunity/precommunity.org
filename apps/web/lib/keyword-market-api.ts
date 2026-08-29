import type {
  AdAdminAuditView,
  AdAdminReportPage,
  AdAdminRevisionView,
  AdCampaignView,
  AdKeywordResponse,
  AdReportReasonCode,
  AdResolveResponse,
  AdsChainStatus,
} from '@precommunity/shared';
import { clientApiJson, clientApiRequest } from './http';

export interface KeywordMarketChainSnapshot {
  status: AdsChainStatus;
  chainId: number;
  contractAddress: string | null;
  deploymentBlock: string | null;
  transactionsEnabled: boolean;
}

export interface AdCreativeInput {
  headline: string;
  description: string;
  destinationUrl: string;
}

export function getKeywordMarketStatus() {
  return clientApiJson<KeywordMarketChainSnapshot>(
    '/v1/keyword-market/status',
    undefined,
    'PRE Keyword Market status',
  );
}

export function resolveAd(query: string) {
  return clientApiJson<AdResolveResponse>(
    `/v1/keyword-market/resolve?q=${encodeURIComponent(query)}`,
    undefined,
    'PRE Keyword Market resolver',
  );
}

export function getAdKeyword(keyword: string) {
  return clientApiJson<AdKeywordResponse>(
    `/v1/keyword-market/keywords/${encodeURIComponent(keyword)}`,
    undefined,
    'PRE Keyword Market keyword',
  );
}

export function reportAd(
  revisionId: string,
  input: { reason: AdReportReasonCode; comment?: string },
) {
  return clientApiJson<{ accepted: true }>(
    `/v1/keyword-market/revisions/${encodeURIComponent(revisionId)}/reports`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
    'Ad report',
  );
}

export function getMyAdCampaigns() {
  return clientApiJson<AdCampaignView[]>(
    '/v1/keyword-market/campaigns/mine',
    undefined,
    'PRE Keyword Market campaigns',
  );
}

export function createAdCampaign(input: AdCreativeInput & { keyword: string }) {
  return clientApiJson<{ id: string; keyword: string; revisionId: string }>(
    '/v1/keyword-market/campaigns',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
    'Campaign creation',
  );
}

export function createAdRevision(campaignId: string, input: AdCreativeInput) {
  return clientApiJson<{ revisionId: string; version: number }>(
    `/v1/keyword-market/campaigns/${encodeURIComponent(campaignId)}/revisions`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
    'Creative submission',
  );
}

export function setAdCampaignPaused(campaignId: string, paused: boolean) {
  return clientApiRequest(
    `/v1/keyword-market/campaigns/${encodeURIComponent(campaignId)}`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ paused }),
    },
    'Campaign update',
  );
}

export function getAdAdminRevisions(status = 'PENDING_REVIEW') {
  return clientApiJson<AdAdminRevisionView[]>(
    `/v1/keyword-market/admin/revisions?status=${encodeURIComponent(status)}`,
    undefined,
    'Creative moderation queue',
  );
}

export function moderateAdRevision(
  revisionId: string,
  action: 'APPROVE' | 'REJECT' | 'SUSPEND' | 'RESTORE',
  note?: string,
) {
  return clientApiRequest(
    `/v1/keyword-market/admin/revisions/${encodeURIComponent(revisionId)}/moderate`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, note }),
    },
    'Creative moderation',
  );
}

export function getAdAdminReports(status = 'OPEN', cursor?: string) {
  const params = new URLSearchParams({ status, limit: '25' });
  if (cursor) params.set('cursor', cursor);
  return clientApiJson<AdAdminReportPage>(
    `/v1/keyword-market/admin/reports?${params}`,
    undefined,
    'Ad report queue',
  );
}

export function getAdAdminAudit() {
  return clientApiJson<AdAdminAuditView[]>(
    '/v1/keyword-market/admin/audit',
    undefined,
    'Ad audit trail',
  );
}

export function resolveAdReports(
  revisionId: string,
  action: 'DISMISS' | 'SUSPEND_AD',
  note?: string,
) {
  return clientApiRequest(
    `/v1/keyword-market/admin/revisions/${encodeURIComponent(revisionId)}/reports/resolve`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, note }),
    },
    'Ad report resolution',
  );
}
