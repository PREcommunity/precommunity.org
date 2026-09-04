export { PRECOMMUNITY_ESCROW_ABI } from './precommunity-escrow-abi';
export * from './ads';
export * from './monthly-schedule';
export {
  BASE_MAINNET_DEPLOYMENT,
  BASE_SEPOLIA_DEPLOYMENT,
  deploymentForNetwork,
  deploymentStateKey,
  explorerTransactionUrl,
  isDeploymentConfigured,
  safeWalletQueueUrl,
} from './deployment';
export type { DeploymentManifest, DeploymentNetwork, DeploymentOverrides } from './deployment';

export const PROJECT_SLUG = 'precommunity';
export const DEFAULT_SUBPROJECT_NAME = 'General';
export const DEFAULT_SUBPROJECT_SLUG = 'general';
export const BASE_MAINNET_CHAIN_ID = 8453;
export const BASE_SEPOLIA_CHAIN_ID = 84532;
export const PRE_DECIMALS = 18;
export const USDC_DECIMALS = 6;

export type AssetCode = 'PRE' | 'USDC';
export type GoalStatus = 'OPEN' | 'EXPIRED' | 'CLOSED' | 'SETTLED' | 'CANCELLED';
export type FundingGoalType = 'ONE_TIME' | 'MONTHLY';
export type MonthlySurplusPolicy = 'PAYOUT_ALL' | 'ROLL_OVER';
export type MonthlyGoalPhase = 'ACTIVE' | 'STOPPING' | 'SETTLEMENT_DUE' | 'CLOSED' | 'CANCELLED';
export type MetadataStatus = 'NOT_SET' | 'AVAILABLE' | 'UNAVAILABLE' | 'INVALID';
export type SponsorVisibility = 'PUBLIC' | 'ANONYMOUS';
export type ChainSyncStatus = 'AWAITING_DEPLOYMENT' | 'SYNCED';
export type CommunityProposalStatus =
  'PENDING_REVIEW' | 'VOTING' | 'PASSED' | 'REJECTED' | 'CONVERTED' | 'DECLINED' | 'REMOVED';
export type ProposalVoteChoice = 'FOR' | 'AGAINST' | 'ABSTAIN';
export type ForumCategoryValue = string;
export type ForumTopicStatus =
  'DRAFT' | 'PENDING_REVIEW' | 'PUBLISHED' | 'LOCKED' | 'DECLINED' | 'REMOVED';

export interface ForumCategoryOption {
  value: ForumCategoryValue;
  label: string;
  archived: boolean;
}

export interface CommunityAuthor {
  address: string;
  displayName: string | null;
  avatarUrl: string | null;
  websiteUrl: string | null;
}

export interface CommunityProposal {
  id: string;
  slug: string;
  title: string;
  description: string;
  category: string;
  status: CommunityProposalStatus;
  snapshotBlock: string | null;
  votingStartsAt: string | null;
  votingEndsAt: string | null;
  closedAt: string | null;
  moderationNote: string | null;
  createdAt: string;
  updatedAt: string;
  author: CommunityAuthor;
  results: { forRaw: string; againstRaw: string; abstainRaw: string; voterCount: number };
  convertedExpense: { id: string; slug: string; status: string } | null;
  comments?: Array<{
    id: string;
    body: string | null;
    state: 'ACTIVE' | 'DELETED' | 'REMOVED';
    editedAt: string | null;
    createdAt: string;
    author: CommunityAuthor;
  }>;
}

export interface ForumReply {
  id: string;
  body: string | null;
  state: 'ACTIVE' | 'DELETED' | 'REMOVED';
  editedAt: string | null;
  createdAt: string;
  author: CommunityAuthor;
  parentReply: {
    id: string;
    body: string | null;
    state: 'ACTIVE' | 'DELETED' | 'REMOVED';
    author: CommunityAuthor;
  } | null;
}

export interface ForumNotification {
  id: string;
  replyId: string;
  topic: { slug: string; title: string | null };
  actor: CommunityAuthor;
  createdAt: string;
  readAt: string | null;
}

export interface ForumNotificationsPage {
  items: ForumNotification[];
  unreadCount: number;
}

export interface ForumTopicSummary {
  id: string;
  slug: string;
  title: string | null;
  excerpt: string | null;
  state: 'ACTIVE' | 'DELETED' | 'REMOVED';
  category: ForumCategoryValue;
  status: ForumTopicStatus;
  replyCount: number;
  lastActivityAt: string;
  createdAt: string;
  updatedAt: string;
  author: CommunityAuthor;
}

export interface ForumTopicDetail extends ForumTopicSummary {
  body: string | null;
  moderationNote: string | null;
  replies: ForumReply[];
  nextReplyCursor: string | null;
}

export interface ForumTopicsPage {
  items: ForumTopicSummary[];
  nextCursor: string | null;
}

export interface ForumRepliesPage {
  items: ForumReply[];
  nextCursor: string | null;
}

export interface ForumConfig {
  topicModerationEnabled: boolean;
  minimumPre: { amount: string; amountRaw: string; asset: 'PRE' };
  categories: ForumCategoryOption[];
}

export interface GoalDocument {
  label: string;
  url: string;
}

export interface GoalMetadata {
  schema: 'precommunity.goal-metadata.v1';
  category?: string;
  subproject?: { name: string; slug: string };
  discussionUrl?: string;
  documents?: GoalDocument[];
}

export interface GoalDraftPreview {
  title: string;
  description: string;
  status: 'DRAFT' | 'PENDING_CHAIN';
  category: string | null;
  subproject: { name: string; slug: string } | null;
  recipientAddress: string;
  cadence: FundingGoalType;
  deadline: string | null;
  monthlySurplusPolicy: MonthlySurplusPolicy | null;
  firstSettlementAt: string | null;
  discussionUrl: string | null;
  metadataUri: string | null;
  documents: GoalDocument[];
  targets: Array<{ asset: AssetCode; amount: string }>;
}

export type GoalPreviewResponse =
  { kind: 'draft'; draft: GoalDraftPreview } | { kind: 'published'; slug: string };

export interface FundingProgress {
  asset: AssetCode;
  target: string;
  funded: string;
  released: string;
  surplus: string;
  percent: number;
}

export interface GoalPayout {
  asset: AssetCode;
  amount: string;
  recipientAddress: `0x${string}`;
  transactionUrl: string;
  executedAt: string;
}

export interface MonthlyPeriodAssetAccounting {
  asset: AssetCode;
  target: string;
  contributed: string;
  carryIn: string;
  vested: string;
  carryOut: string;
}

export interface FundingGoalPeriodSummary {
  periodIndex: number;
  startsAt: string;
  endsAt: string;
  surplusPolicy: MonthlySurplusPolicy;
  finalPeriod: boolean;
  settledAt: string | null;
  settlementTxHash: `0x${string}` | null;
  settlementBlock: string | null;
  settlementBlockHash: `0x${string}` | null;
  settlementLogIndex: number | null;
  assets: MonthlyPeriodAssetAccounting[];
}

export interface GoalLifetimeAssetAccounting {
  asset: AssetCode;
  contributions: string;
  beneficiaryEntitlement: string;
  treasuryEntitlement: string;
  beneficiaryPayouts: string;
  treasuryPayouts: string;
  beneficiaryAvailable: string;
  treasuryAvailable: string;
}

export interface GoalSummary {
  id: string;
  slug: string;
  title: string;
  description: string;
  category?: string;
  subproject?: { name: string; slug: string };
  goalId: string;
  chainGoalId: `0x${string}`;
  recipientAddress: `0x${string}`;
  creatorAddress: `0x${string}`;
  goalType: FundingGoalType;
  deadline: string;
  creationTxHash: `0x${string}`;
  creationBlock: string;
  discussionUrl?: string;
  metadataUri?: string;
  metadataStatus: MetadataStatus;
  documents: GoalDocument[];
  status: GoalStatus;
  progress: FundingProgress[];
  monthly?: {
    phase: MonthlyGoalPhase;
    surplusPolicy: MonthlySurplusPolicy;
    firstSettlementAt: string;
    settlementDay: number;
    stopRequestedAt: string | null;
    periodsSettled: number;
    selectedPeriod: FundingGoalPeriodSummary;
    lifetime: GoalLifetimeAssetAccounting[];
  };
  payouts?: GoalPayout[];
}

export interface DashboardResponse {
  source: 'CHAIN';
  project: { name: 'precommunity'; slug: 'precommunity'; description: string };
  month: string;
  generatedAt: string;
  chainId: number;
  network: string;
  escrowAddress: `0x${string}`;
  indexedThroughBlock: string | null;
  confirmations: number;
  lastIndexedAt: string | null;
  syncStatus: ChainSyncStatus;
  totals: FundingProgress[];
  goals: GoalSummary[];
  activity: Array<{
    id: string;
    kind: 'CONTRIBUTION' | 'PAYOUT';
    label: string;
    amount: string;
    asset: AssetCode;
    occurredAt: string;
    transactionUrl: string;
    sponsorUrl?: string;
    sponsorAvatarUrl?: string;
  }>;
}

export interface GoalContribution {
  id: string;
  label: string;
  amount: string;
  asset: AssetCode;
  visibility: SponsorVisibility;
  occurredAt: string;
  blockNumber: string;
  transactionUrl: string;
  sponsorUrl?: string;
  sponsorAvatarUrl?: string;
}

export interface GoalContributionsPage {
  items: GoalContribution[];
  nextCursor: string | null;
}

export interface FundingGoalPeriodsPage {
  items: FundingGoalPeriodSummary[];
  nextCursor: string | null;
}

export interface MonthlySettlementRequest {
  goalId: `0x${string}`;
  periodsDue: number;
  maxPeriods: number;
  remainingAfterThisTransaction: number;
  indexedThroughBlock: string | null;
  transactionRequest: {
    chainId: number;
    to: `0x${string}`;
    value: string;
    data: `0x${string}`;
  };
}

export function utcMonthStart(date = new Date()): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

export function isValidPublicUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

export function isValidIpfsUri(value: string): boolean {
  if (value === '') return true;
  if (!value.startsWith('ipfs://') || value.includes('?') || value.includes('#')) return false;
  const [cid, ...path] = value.slice('ipfs://'.length).split('/');
  if (!cid || !isStructurallyValidCid(cid)) return false;
  return path.every((segment) => /^[A-Za-z0-9._~!$&'()*+,;=:@%-]*$/.test(segment));
}

function isStructurallyValidCid(value: string) {
  if (/^Qm[1-9A-HJ-NP-Za-km-z]{44}$/.test(value)) {
    const decoded = decodeBase58(value);
    return decoded?.length === 34 && decoded[0] === 0x12 && decoded[1] === 0x20;
  }
  if (!/^b[a-z2-7]+$/.test(value)) return false;
  const decoded = decodeBase32(value.slice(1));
  if (!decoded) return false;
  const version = readVarint(decoded, 0);
  if (!version || version.value !== 1) return false;
  const codec = readVarint(decoded, version.next);
  if (!codec || codec.value < 1) return false;
  const hashCode = readVarint(decoded, codec.next);
  if (!hashCode || hashCode.value < 1) return false;
  const digestLength = readVarint(decoded, hashCode.next);
  return Boolean(
    digestLength &&
    digestLength.value > 0 &&
    digestLength.next + digestLength.value === decoded.length,
  );
}

function decodeBase58(value: string) {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let number = 0n;
  for (const character of value) {
    const digit = alphabet.indexOf(character);
    if (digit < 0) return null;
    number = number * 58n + BigInt(digit);
  }
  const bytes: number[] = [];
  while (number > 0n) {
    bytes.push(Number(number & 0xffn));
    number >>= 8n;
  }
  for (const character of value) {
    if (character !== '1') break;
    bytes.push(0);
  }
  return Uint8Array.from(bytes.reverse());
}

function decodeBase32(value: string) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
  const output: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const character of value) {
    const digit = alphabet.indexOf(character);
    if (digit < 0) return null;
    buffer = (buffer << 5) | digit;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      output.push((buffer >> bits) & 0xff);
      buffer &= (1 << bits) - 1;
    }
  }
  if (bits > 0 && buffer !== 0) return null;
  return Uint8Array.from(output);
}

function readVarint(bytes: Uint8Array, offset: number) {
  let value = 0n;
  let shift = 0n;
  for (let index = offset; index < bytes.length && index < offset + 10; index += 1) {
    const byte = bytes[index]!;
    value |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) {
      if (index > offset && byte === 0) return null;
      if (value > BigInt(Number.MAX_SAFE_INTEGER)) return null;
      return { value: Number(value), next: index + 1 };
    }
    shift += 7n;
  }
  return null;
}

export function canonicalGoalMetadata(input: Omit<GoalMetadata, 'schema'>): GoalMetadata {
  const documents = input.documents
    ?.map((document) => ({ label: document.label.trim(), url: document.url.trim() }))
    .filter((document) => document.label && isValidPublicUrl(document.url))
    .sort((left, right) => left.label.localeCompare(right.label));
  const subproject = input.subproject
    ? {
        name: input.subproject.name.trim(),
        slug: input.subproject.slug.trim(),
      }
    : undefined;
  return {
    schema: 'precommunity.goal-metadata.v1',
    ...(input.category?.trim() ? { category: input.category.trim() } : {}),
    ...(subproject?.name && subproject.slug && subproject.slug !== DEFAULT_SUBPROJECT_SLUG
      ? {
          subproject,
        }
      : {}),
    ...(input.discussionUrl?.trim() && isValidPublicUrl(input.discussionUrl.trim())
      ? { discussionUrl: input.discussionUrl.trim() }
      : {}),
    ...(documents?.length ? { documents } : {}),
  };
}
