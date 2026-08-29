export const ADS_ALGORITHM_VERSION = 'keyword-longest-v1' as const;
export const ADS_MAX_QUERY_CHARACTERS = 256;
export const ADS_MAX_QUERY_TOKENS = 32;
export const ADS_MAX_KEYWORD_CHARACTERS = 64;
export const ADS_MAX_KEYWORD_TOKENS = 5;

export const AD_REPORT_REASONS = [
  'SCAM_PHISHING',
  'MISLEADING',
  'INAPPROPRIATE',
  'BROKEN_LINK',
  'OTHER',
] as const;

export type AdReportReasonCode = (typeof AD_REPORT_REASONS)[number];
export type AdsChainStatus = 'AWAITING_CONTRACT' | 'SYNCING' | 'SYNCED';
export type AdCreativeStatusCode =
  'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'SUSPENDED' | 'SUPERSEDED';

export class AdsTextValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdsTextValidationError';
  }
}

export interface AdsToken {
  value: string;
  tokenIndex: number;
}

export interface AdsKeywordCandidate {
  keyword: string;
  tokenCount: number;
  characterCount: number;
  startToken: number;
}

function characterCount(value: string) {
  return Array.from(value).length;
}

export function tokenizeAdsText(value: string): AdsToken[] {
  const normalized = value.normalize('NFKC').toLowerCase();
  return Array.from(normalized.matchAll(/[\p{L}\p{N}]+/gu), (match, tokenIndex) => ({
    value: match[0],
    tokenIndex,
  }));
}

export function normalizeAdKeyword(value: string): string {
  const tokens = tokenizeAdsText(value);
  if (!tokens.length) throw new AdsTextValidationError('Keyword must contain a letter or number.');
  if (tokens.length > ADS_MAX_KEYWORD_TOKENS) {
    throw new AdsTextValidationError(
      `Keyword must contain at most ${ADS_MAX_KEYWORD_TOKENS} tokens.`,
    );
  }
  const keyword = tokens.map((token) => token.value).join(' ');
  if (characterCount(keyword) > ADS_MAX_KEYWORD_CHARACTERS) {
    throw new AdsTextValidationError(
      `Keyword must contain at most ${ADS_MAX_KEYWORD_CHARACTERS} characters.`,
    );
  }
  return keyword;
}

export function adsKeywordCandidates(query: string): AdsKeywordCandidate[] {
  const normalized = query.normalize('NFKC');
  if (characterCount(normalized) > ADS_MAX_QUERY_CHARACTERS) {
    throw new AdsTextValidationError(
      `Query must contain at most ${ADS_MAX_QUERY_CHARACTERS} characters.`,
    );
  }
  const tokens = tokenizeAdsText(normalized);
  if (!tokens.length) throw new AdsTextValidationError('Query must contain a letter or number.');
  if (tokens.length > ADS_MAX_QUERY_TOKENS) {
    throw new AdsTextValidationError(`Query must contain at most ${ADS_MAX_QUERY_TOKENS} tokens.`);
  }

  const candidates = new Map<string, AdsKeywordCandidate>();
  for (let start = 0; start < tokens.length; start += 1) {
    for (let size = 1; size <= ADS_MAX_KEYWORD_TOKENS && start + size <= tokens.length; size += 1) {
      const keyword = tokens
        .slice(start, start + size)
        .map((token) => token.value)
        .join(' ');
      if (characterCount(keyword) > ADS_MAX_KEYWORD_CHARACTERS) continue;
      const candidate = {
        keyword,
        tokenCount: size,
        characterCount: characterCount(keyword),
        startToken: start,
      };
      const previous = candidates.get(keyword);
      if (!previous || candidate.startToken < previous.startToken)
        candidates.set(keyword, candidate);
    }
  }

  return [...candidates.values()].sort(
    (left, right) =>
      right.tokenCount - left.tokenCount ||
      right.characterCount - left.characterCount ||
      left.startToken - right.startToken ||
      left.keyword.localeCompare(right.keyword, 'en'),
  );
}

export function adsUtcDay(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export function adResolutionCounterKey(day: string) {
  return `precommunity:ads:resolutions:${day}`;
}

export interface AdStakeProof {
  chainId: number;
  contractAddress: string;
  stakerAddress: string;
  stakeRaw: string;
  positionBlock: string;
  positionTxHash: string;
  indexedThroughBlock: string | null;
}

export interface AdResolveCreative {
  revisionId: string;
  headline: string;
  description: string;
  destinationUrl: string;
  displayDomain: string;
  matchedKeyword: string;
  proof: AdStakeProof;
}

export interface AdResolveResponse {
  requestId: string;
  algorithmVersion: typeof ADS_ALGORITHM_VERSION;
  ad: AdResolveCreative | null;
}

export interface AdKeywordPositionView {
  rank: number;
  stakerAddress: string;
  stakeRaw: string;
  amountSinceBlock: string;
  amountSinceLogIndex: number;
  positionBlock: string;
  positionTxHash: string;
  hasEligibleAd: boolean;
}

export interface AdKeywordResponse {
  keyword: string;
  chainStatus: AdsChainStatus;
  chainId: number;
  contractAddress: string | null;
  indexedThroughBlock: string | null;
  positions: AdKeywordPositionView[];
}

export interface AdRevisionView {
  id: string;
  version: number;
  headline: string;
  description: string;
  destinationUrl: string;
  displayDomain: string;
  status: AdCreativeStatusCode;
  moderationNote: string | null;
  createdAt: string;
  lifetimeResolutions: string;
  last30DaysResolutions: string;
}

export interface AdCampaignView {
  id: string;
  keyword: string;
  paused: boolean;
  chainStatus: AdsChainStatus;
  position: AdKeywordPositionView | null;
  leaderStakeRaw: string | null;
  stakeNeededToLeadRaw: string | null;
  activeRevision: AdRevisionView | null;
  pendingRevision: AdRevisionView | null;
  revisions: AdRevisionView[];
  createdAt: string;
  updatedAt: string;
}

export interface AdAdminRevisionView extends AdRevisionView {
  keyword: string;
  advertiserAddress: string;
  reportCount: string;
  proof: AdStakeProof | null;
}

export interface AdAdminReportItem {
  id: string;
  reason: AdReportReasonCode;
  comment: string | null;
  createdAt: string;
}

export interface AdAdminReportGroup {
  revision: AdAdminRevisionView;
  reports: AdAdminReportItem[];
  matchingReportCount: string;
  reportsTruncated: boolean;
}

export interface AdAdminReportPage {
  items: AdAdminReportGroup[];
  nextCursor: string | null;
}

export interface AdAdminAuditView {
  id: string;
  actorAddress: string | null;
  entityId: string;
  action: string;
  before: unknown;
  after: unknown;
  createdAt: string;
}
