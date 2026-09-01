import type { GoalDocument } from '@precommunity/shared';
import type { SafeTransactionData } from '@safe-global/types-kit';
import type { Hex } from 'viem';

export interface AdminTarget {
  id: string;
  asset: 'PRE' | 'USDC';
  amount: string;
}

export interface AdminGoal {
  id: string;
  creatorAddress: `0x${string}`;
  status: 'OPEN' | 'CLOSED' | 'CANCELLED' | 'SETTLED';
  deadline: string;
  goalType: 'ONE_TIME' | 'MONTHLY';
  monthlySurplusPolicy: 'PAYOUT_ALL' | 'ROLL_OVER' | null;
  monthlyFirstSettlementAt: string | null;
  monthlySettlementDay: number | null;
  monthlyStopRequestedAt: string | null;
  monthlyPeriodsSettled: number;
  preTargetRaw: string;
  usdcTargetRaw: string;
  preRecipientEntitlementRaw: string;
  usdcRecipientEntitlementRaw: string;
  preCarryRaw: string;
  usdcCarryRaw: string;
  preTreasuryEntitlementRaw: string;
  usdcTreasuryEntitlementRaw: string;
  periods: Array<{
    periodIndex: number;
    startsAt: string;
    endsAt: string;
    settledAt: string | null;
    finalPeriod: boolean;
  }>;
  fundingTotals: Record<
    'PRE' | 'USDC',
    { fundedRaw: string; expenseReleasedRaw: string; cancelledFundsReleasedRaw: string }
  >;
}

export interface AdminGoalDraft {
  id: string;
  subprojectId: string;
  name: string;
  slug: string;
  status: 'DRAFT' | 'PENDING_CHAIN' | 'PUBLISHED' | 'ARCHIVED';
  description: string;
  purpose: string;
  category?: string | null;
  cadence: 'ONE_TIME' | 'MONTHLY';
  monthlySurplusPolicy?: 'PAYOUT_ALL' | 'ROLL_OVER' | null;
  firstSettlementAtOverride?: string | null;
  recipientAddress: string;
  deadline?: string | null;
  discussionUrl?: string | null;
  metadataUri?: string | null;
  metadataDocuments?: GoalDocument[] | null;
  pendingChainTxHash?: string;
  targets: AdminTarget[];
  goals?: AdminGoal[];
}

export interface AdminSubproject {
  id: string;
  name: string;
  slug: string;
  expenses: AdminGoalDraft[];
}

export interface AdminGoalDraftInput {
  subprojectId?: string;
  name: string;
  slug: string;
  description: string;
  purpose: string;
  category?: string;
  cadence: 'ONE_TIME' | 'MONTHLY';
  monthlySurplusPolicy?: 'PAYOUT_ALL' | 'ROLL_OVER';
  firstSettlementAt?: string | null;
  recipientAddress: string;
  deadline?: string;
  discussionUrl?: string;
  metadataUri?: string;
  documents?: GoalDocument[];
  targets: Array<{ asset: 'PRE' | 'USDC'; amount: string }>;
}

export interface AdminGoalDraftUpdateInput {
  subprojectId: string | null;
  name: string;
  slug: string;
  description: string;
  purpose: string;
  category: string | null;
  cadence: 'ONE_TIME' | 'MONTHLY';
  monthlySurplusPolicy: 'PAYOUT_ALL' | 'ROLL_OVER' | null;
  firstSettlementAt: string | null;
  recipientAddress: string;
  deadline: string | null;
  discussionUrl: string | null;
  metadataUri: string | null;
  documents: GoalDocument[];
  targets: Array<{ asset: 'PRE' | 'USDC'; amount: string }>;
}

export interface AdminTransactionRequest {
  chainId: number;
  to: `0x${string}`;
  value: string;
  data: Hex;
}

export interface AdminSafeContractCall extends AdminTransactionRequest {
  operation: SafeTransactionData['operation'];
}

export type AdminSafeDelivery = 'SERVICE' | 'MANUAL';

export interface AdminManualSafeExport {
  mode: 'MANUAL';
  name: string;
  description: string;
  chainId: number;
  safeAddress: `0x${string}`;
  queueUrl: string;
  transactions: AdminSafeContractCall[];
  transactionRequest: AdminTransactionRequest;
  id?: string;
  reservationId?: string;
  delivery?: 'MANUAL';
}

export type ChainAuthority = 'OWNER' | 'GOAL_MANAGER';

export interface AdminSessionPrincipal {
  address: `0x${string}`;
  roles: Array<'SUPER_ADMIN' | 'CONTENT_ADMIN' | 'FINANCE_ADMIN'>;
  chainAuthorities: ChainAuthority[];
  safeOwner: boolean;
  canAccessSafeOwnershipAcceptance: boolean;
  safeAddress: `0x${string}` | null;
}

export interface AdminSafeOwnershipAcceptance {
  safeTxHash: Hex;
  safeNonce: number;
  confirmations: number;
  threshold: number;
  readyToExecute: boolean;
  queueUrl: string;
}

export interface AdminSafeStatus {
  configured: boolean;
  serviceConfigured: boolean;
  network: 'base' | 'base-sepolia';
  networkName: string;
  chainId: number;
  escrowAddress: `0x${string}`;
  address?: `0x${string}`;
  owners?: `0x${string}`[];
  threshold?: number;
  nonce?: number;
  escrowOwner?: `0x${string}`;
  isEscrowOwner?: boolean;
  pendingOwner?: `0x${string}`;
  isPendingEscrowOwner?: boolean;
  ownershipAcceptance?: AdminSafeOwnershipAcceptance | null;
  goalManagerReady?: boolean;
  queueUrl?: string;
  safeOwner: boolean;
  error?: string;
}

export type AdminSafeGoalManagerProposalStatus =
  'SUBMITTING' | 'AWAITING_CONFIRMATIONS' | 'READY_TO_EXECUTE' | 'EXECUTED' | 'STALE' | 'FAILED';

export interface AdminSafeGoalManagerProposal {
  safeTxHash: Hex;
  safeNonce: string;
  confirmations: number;
  threshold: number;
  status: AdminSafeGoalManagerProposalStatus;
  executionTxHash: Hex | null;
  failureReason: string | null;
  changes: Array<{ address: `0x${string}`; enabled: boolean }>;
  queueUrl: string;
}

export interface AdminGoalManagerEntry {
  address: `0x${string}`;
  safeOwner: boolean;
  safeManaged: boolean;
  manualPinned: boolean;
  legacy: boolean;
  actual: boolean;
  desired: boolean;
  onChainEnabled: boolean;
  openGoalCount: number;
  status: 'SYNCED' | 'NEEDS_ADD' | 'NEEDS_REMOVE';
}

export interface AdminGoalManagerWorkspace {
  safeConfigured: boolean;
  safeAddress: `0x${string}` | null;
  safeIsEscrowOwner: boolean;
  actorIsSafeOwner: boolean;
  maxOpenGoalsPerManager: number;
  inSync: boolean;
  entries: AdminGoalManagerEntry[];
  activeProposal: AdminSafeGoalManagerProposal | null;
  latestProposal: AdminSafeGoalManagerProposal | null;
}

export type AdminGoalManagerChangeRequest =
  | { mode: 'NONE'; changes: [] }
  | {
      mode: 'DIRECT';
      changes: Array<{ address: `0x${string}`; enabled: boolean }>;
      transactions: AdminSafeContractCall[];
    }
  | {
      mode: 'SAFE';
      intentId: string;
      changes: Array<{ address: `0x${string}`; enabled: boolean }>;
      transactions: AdminSafeContractCall[];
      safeAddress: `0x${string}`;
      safeNonce: number;
      threshold: number;
      queueUrl: string;
    }
  | (AdminManualSafeExport & {
      changes: Array<{ address: `0x${string}`; enabled: boolean }>;
    })
  | {
      mode: 'PENDING';
      changes: Array<{ address: `0x${string}`; enabled: boolean }>;
      proposal: AdminSafeGoalManagerProposal;
    };

export type AdminSafeProposalStatus =
  | 'SUBMITTING'
  | 'AWAITING_CONFIRMATIONS'
  | 'READY_TO_EXECUTE'
  | 'AWAITING_EXECUTION'
  | 'EXECUTED'
  | 'CANCELLED'
  | 'STALE'
  | 'FAILED';

export interface AdminSafePayoutProposal {
  id: string;
  intentId: string;
  delivery: AdminSafeDelivery;
  goalId: string;
  safeAddress: `0x${string}`;
  safeTxHash: Hex | null;
  safeNonce: string | null;
  status: AdminSafeProposalStatus;
  confirmations: number | null;
  threshold: number | null;
  executionTxHash: Hex | null;
  failureReason: string | null;
  queueUrl: string;
  goalTitle: string | null;
  asset: 'PRE' | 'USDC';
  kind: 'EXPENSE' | 'CANCELLED_FUNDS';
  amountRaw: string;
  recipientAddress: `0x${string}`;
  payoutStatus: 'PROPOSED' | 'EXECUTED' | 'FAILED';
  transactionRequest: AdminTransactionRequest | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminSafePayoutIntent {
  delivery: 'SERVICE';
  id: string;
  expiresAt: string;
  safeAddress: `0x${string}`;
  safeNonce: number;
  threshold: number;
  queueUrl: string;
  transactionRequest: AdminTransactionRequest;
}

export type AdminSafePayoutPreparation = AdminSafePayoutIntent | AdminManualSafeExport;

export type AdminGoalLifecycleKind =
  'SET_MONTHLY_SURPLUS_POLICY' | 'REQUEST_MONTHLY_STOP' | 'CANCEL_MONTHLY';

export type AdminSafeGoalActionIntent = AdminSafePayoutIntent;

export type AdminGoalLifecyclePreparation =
  | {
      mode: 'DIRECT';
      transactionRequest: AdminTransactionRequest;
    }
  | ({ mode: 'SAFE' } & AdminSafeGoalActionIntent)
  | AdminManualSafeExport;

export interface AdminSafeGoalActionProposal {
  id: string;
  intentId: string;
  safeTxHash: Hex;
  safeNonce: string;
  senderAddress: `0x${string}`;
  confirmations: number;
  threshold: number;
  status: AdminSafeProposalStatus;
  executionTxHash: Hex | null;
  failureReason: string | null;
  queueUrl: string | null;
  intent?: {
    kind: AdminGoalLifecycleKind;
    goal: { id: string; slug: string; title: string; status: string };
  };
}

export interface AdminSafeOwnershipAcceptanceRequest {
  safeAddress: `0x${string}`;
  safeNonce: number;
  threshold: number;
  queueUrl: string;
  transactionRequest: AdminTransactionRequest;
  existingProposal?: AdminSafeOwnershipAcceptance | null;
}

export type AdminSafeOwnershipAcceptancePreparation =
  AdminSafeOwnershipAcceptanceRequest | AdminManualSafeExport;

export interface AdminSafeProposalSubmission {
  transaction: SafeTransactionData;
  safeTxHash: Hex;
  senderAddress: `0x${string}`;
  senderSignature: Hex;
}

export type AdminWorkspaceState = 'idle' | 'loading' | 'ready' | 'unauthorized' | 'error';
