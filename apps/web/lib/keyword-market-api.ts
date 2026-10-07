import type {
  AdAdminAuditView,
  AdAdminReportPage,
  AdAdminRevisionView,
  AdApiKeyCreateResponse,
  AdApiKeyView,
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
  indexedThroughBlock: string | null;
  minimumStakeRaw: string | null;
  preTokenAddress: string;
}

export interface AdTransactionProjection {
  chainStatus: AdsChainStatus;
  indexed: boolean;
  chainId: number;
  contractAddress: string | null;
  blockNumber: string | null;
  blockHash: string | null;
}

export function isAdTransactionIndexed(
  campaign: { chainStatus: AdsChainStatus },
  snapshot: Pick<KeywordMarketChainSnapshot, 'status' | 'indexedThroughBlock'>,
  projection: Pick<
    AdTransactionProjection,
    'chainStatus' | 'indexed' | 'blockNumber' | 'blockHash'
  >,
  receipt: { blockNumber: bigint; blockHash: string },
) {
  return (
    campaign.chainStatus === 'SYNCED' &&
    snapshot.status === 'SYNCED' &&
    projection.chainStatus === 'SYNCED' &&
    projection.indexed &&
    projection.blockNumber === receipt.blockNumber.toString() &&
    projection.blockHash?.toLowerCase() === receipt.blockHash.toLowerCase() &&
    snapshot.indexedThroughBlock !== null &&
    BigInt(snapshot.indexedThroughBlock) >= receipt.blockNumber
  );
}

export interface KeywordMarketTransaction {
  chainId: number;
  to: `0x${string}`;
  data: `0x${string}`;
  valueRaw: string;
}

export type AdStakeTransactionPlan =
  | {
      status: 'AWAITING_CONTRACT' | 'SYNCING';
      operation: 'STAKE' | 'REQUEST_UNSTAKE' | 'UNSTAKE';
      enabled: false;
      transaction: null;
    }
  | {
      status: 'READY';
      operation: 'STAKE' | 'REQUEST_UNSTAKE' | 'UNSTAKE';
      enabled: true;
      keywordId: `0x${string}`;
      tokenAddress: `0x${string}`;
      approvalTransaction: KeywordMarketTransaction | null;
      transaction: KeywordMarketTransaction;
    };

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

export function getAdTransactionProjection(txHash: `0x${string}`) {
  return clientApiJson<AdTransactionProjection>(
    `/v1/keyword-market/transactions/${encodeURIComponent(txHash)}`,
    undefined,
    'PRE Keyword Market transaction projection',
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

function prepareAdStake(
  campaignId: string,
  action: '' | '/request-unstake' | '/unstake',
  input?: { amountRaw: string; bidUsdRaw: string },
) {
  return clientApiJson<AdStakeTransactionPlan>(
    `/v1/keyword-market/campaigns/${encodeURIComponent(campaignId)}/stake${action}/prepare`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: input ? JSON.stringify(input) : '{}',
    },
    'Stake transaction preparation',
  );
}

export function prepareAdStakeBid(campaignId: string, amountRaw: string, bidUsdRaw: string) {
  return prepareAdStake(campaignId, '', { amountRaw, bidUsdRaw });
}

export function prepareAdUnstakeRequest(campaignId: string) {
  return prepareAdStake(campaignId, '/request-unstake');
}

export function prepareAdUnstake(campaignId: string) {
  return prepareAdStake(campaignId, '/unstake');
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

export function getAdApiKeys() {
  return clientApiJson<AdApiKeyView[]>(
    '/v1/keyword-market/admin/api-keys',
    undefined,
    'Keyword Market API keys',
  );
}

export function createAdApiKey(name: string) {
  return clientApiJson<AdApiKeyCreateResponse>(
    '/v1/keyword-market/admin/api-keys',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    },
    'API key creation',
  );
}

export function revokeAdApiKey(id: string) {
  return clientApiRequest(
    `/v1/keyword-market/admin/api-keys/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
    'API key revocation',
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
