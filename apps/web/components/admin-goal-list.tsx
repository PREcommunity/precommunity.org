'use client';

import { useState } from 'react';
import { Check, LoaderCircle, Pencil, RefreshCw, Send } from 'lucide-react';
import { formatUnits } from 'viem';
import type {
  AdminGoal,
  AdminGoalDraft,
  AdminGoalDraftUpdateInput,
  AdminSafePayoutProposal,
  AdminSafeDelivery,
  AdminSubproject,
} from '@/lib/admin-workspace-types';
import { ActionButton } from './action-button';
import { AdminGoalEditForm } from './admin-goal-edit-form';
import { monthlyPeriodPreview } from './monthly-schedule-fields';

interface AdminGoalListProps {
  workspace: AdminSubproject[];
  transactionPending: boolean;
  safeProposals: AdminSafePayoutProposal[];
  canProposeSafePayout: boolean;
  safeDelivery: AdminSafeDelivery;
  canManageGoals: boolean;
  currentAddress?: string;
  chainAuthorities: Array<'OWNER' | 'GOAL_MANAGER'>;
  onPublish: (id: string) => Promise<void>;
  onUpdateDraft: (id: string, input: AdminGoalDraftUpdateInput) => Promise<boolean>;
  onCloseGoal: (id: string) => Promise<void>;
  onCancelGoal: (id: string) => Promise<void>;
  onLifecycle: (
    id: string,
    kind: 'SET_MONTHLY_SURPLUS_POLICY' | 'REQUEST_MONTHLY_STOP' | 'CANCEL_MONTHLY',
    policy?: 'PAYOUT_ALL' | 'ROLL_OVER',
  ) => Promise<void>;
  onRelease: (
    goalId: string,
    asset: 'PRE' | 'USDC',
    kind: 'EXPENSE' | 'CANCELLED_FUNDS',
    amountRaw: bigint,
  ) => Promise<void>;
}

function monthlyDraftSummary(draft: AdminGoalDraft, goal?: AdminGoal) {
  if (goal?.monthlyFirstSettlementAt) {
    return {
      firstDate: new Intl.DateTimeFormat('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(new Date(goal.monthlyFirstSettlementAt)),
      baseDay: goal.monthlySettlementDay,
      mode: 'Published on-chain',
    };
  }
  const customDate = draft.firstSettlementAtOverride?.slice(0, 10);
  const preview = monthlyPeriodPreview(new Date(), customDate);
  const firstDate = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(preview.settlementDates[0]!));
  return {
    firstDate,
    baseDay: preview.settlementDay,
    mode: customDate ? 'Custom date' : 'Automatic · same day next month',
  };
}

function surplusSummary(policy?: 'PAYOUT_ALL' | 'ROLL_OVER' | null) {
  return policy === 'PAYOUT_ALL'
    ? {
        label: 'Payout all',
        detail: 'The full period balance becomes payable to the recipient.',
      }
    : {
        label: 'Roll over',
        detail: 'Up to the monthly target becomes payable; the excess moves to the next month.',
      };
}

function available(
  goal: AdminGoal,
  asset: 'PRE' | 'USDC',
  kind: 'EXPENSE' | 'CANCELLED_FUNDS',
  proposals: AdminSafePayoutProposal[],
) {
  const totals = goal.fundingTotals[asset];
  const entitlement = BigInt(
    kind === 'EXPENSE'
      ? asset === 'PRE'
        ? goal.preRecipientEntitlementRaw
        : goal.usdcRecipientEntitlementRaw
      : asset === 'PRE'
        ? goal.preTreasuryEntitlementRaw
        : goal.usdcTreasuryEntitlementRaw,
  );
  const released = BigInt(
    kind === 'EXPENSE' ? totals.expenseReleasedRaw : totals.cancelledFundsReleasedRaw,
  );
  const reserved = proposals
    .filter(
      (proposal) =>
        proposal.goalId === goal.id &&
        proposal.asset === asset &&
        proposal.kind === kind &&
        proposal.payoutStatus === 'PROPOSED',
    )
    .reduce((sum, proposal) => sum + BigInt(proposal.amountRaw), 0n);
  const allocated = released + reserved;
  return entitlement > allocated ? entitlement - allocated : 0n;
}

export function AdminGoalList({
  workspace,
  transactionPending,
  safeProposals,
  canProposeSafePayout,
  safeDelivery,
  canManageGoals,
  currentAddress,
  chainAuthorities,
  onPublish,
  onUpdateDraft,
  onCloseGoal,
  onCancelGoal,
  onLifecycle,
  onRelease,
}: AdminGoalListProps) {
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);

  if (!workspace.length) {
    return <p className="m-0 mt-7 border-y border-line py-6 text-muted">No subprojects yet.</p>;
  }

  return (
    <div className="mt-7">
      {workspace.map((subproject) => (
        <section className="mb-8" key={subproject.id}>
          <div className="flex items-end justify-between border-b border-navy pb-2">
            <h2 className="m-0 text-xl">{subproject.name}</h2>
            <span className="text-[10px] text-muted">{subproject.expenses.length} drafts</span>
          </div>
          {!subproject.expenses.length ? (
            <p className="text-[11px] text-muted">No drafts in this subproject.</p>
          ) : null}
          {subproject.expenses.map((draft) => {
            const goal = draft.goals?.[0];
            const schedule = draft.cadence === 'MONTHLY' ? monthlyDraftSummary(draft, goal) : null;
            const surplus =
              draft.cadence === 'MONTHLY' ? surplusSummary(draft.monthlySurplusPolicy) : null;
            const canDirectlyControlGoal = Boolean(
              goal &&
              (chainAuthorities.includes('OWNER') ||
                (chainAuthorities.includes('GOAL_MANAGER') &&
                  currentAddress?.toLowerCase() === goal.creatorAddress.toLowerCase())),
            );
            return (
              <article
                className="grid grid-cols-[minmax(220px,1fr)_auto_auto] items-center gap-4 border-b border-line py-3.5 max-sm:grid-cols-1"
                key={draft.id}
              >
                <span className="flex flex-col">
                  <small className="font-mono text-[9px] text-blue">{draft.status}</small>
                  <strong className="my-[3px]">{draft.name}</strong>
                  <em className="text-[11px] text-muted not-italic">
                    {draft.cadence === 'MONTHLY' ? 'Monthly' : 'One-time'} · {draft.purpose}
                  </em>
                </span>
                <span className="flex flex-wrap gap-[7px]">
                  {draft.targets.map((target) => (
                    <i
                      className="bg-blue-soft px-1.5 py-1 font-mono text-[9px] not-italic"
                      key={target.id}
                    >
                      {target.amount} {target.asset}
                    </i>
                  ))}
                </span>
                {draft.status === 'DRAFT' ||
                (draft.status === 'PENDING_CHAIN' && !draft.pendingChainTxHash) ? (
                  <span className="flex justify-end gap-2 max-sm:justify-start">
                    {draft.status === 'DRAFT' ? (
                      <ActionButton
                        size="compact"
                        icon={<Pencil size={14} />}
                        onClick={() =>
                          setEditingDraftId((current) => (current === draft.id ? null : draft.id))
                        }
                      >
                        {editingDraftId === draft.id ? 'Close edit' : 'Edit'}
                      </ActionButton>
                    ) : null}
                    <ActionButton
                      size="compact"
                      icon={
                        draft.status === 'PENDING_CHAIN' ? (
                          <RefreshCw size={14} />
                        ) : (
                          <Send size={14} />
                        )
                      }
                      onClick={() => void onPublish(draft.id)}
                      disabled={
                        transactionPending || !canManageGoals || editingDraftId === draft.id
                      }
                    >
                      {editingDraftId === draft.id
                        ? 'Save edit first'
                        : !canManageGoals
                          ? 'Goal manager required'
                          : draft.status === 'PENDING_CHAIN'
                            ? 'Retry publication'
                            : 'Sign & publish'}
                    </ActionButton>
                  </span>
                ) : draft.status === 'PENDING_CHAIN' ? (
                  <span className="inline-flex items-center gap-1.5 text-[10px] text-muted">
                    <LoaderCircle className="animate-spin" size={14} /> Awaiting confirmation…
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-[10px] text-muted">
                    <Check size={14} /> Chain published
                  </span>
                )}
                {schedule && surplus ? (
                  <div className="col-span-full grid grid-cols-2 gap-x-8 gap-y-3 border-t border-line pt-3 max-sm:grid-cols-1">
                    <span className="flex flex-col">
                      <small className="font-mono text-[9px] tracking-[.04em] text-muted uppercase">
                        Settlement
                      </small>
                      <strong className="mt-1 text-xs">{schedule.firstDate} · 00:00 UTC</strong>
                      <span className="mt-1 text-[10px] leading-4 text-muted">
                        {schedule.mode}. Repeats monthly on base day {schedule.baseDay}. Settlement
                        updates accounting; payout is separate.
                      </span>
                    </span>
                    <span className="flex flex-col">
                      <small className="font-mono text-[9px] tracking-[.04em] text-muted uppercase">
                        Surplus policy
                      </small>
                      <strong className="mt-1 text-xs">{surplus.label}</strong>
                      <span className="mt-1 text-[10px] leading-4 text-muted">
                        {surplus.detail} Settlement does not transfer funds automatically.
                      </span>
                    </span>
                  </div>
                ) : null}
                {draft.status === 'DRAFT' && editingDraftId === draft.id ? (
                  <AdminGoalEditForm
                    draft={draft}
                    workspace={workspace}
                    onCancel={() => setEditingDraftId(null)}
                    onSave={(input) => onUpdateDraft(draft.id, input)}
                  />
                ) : null}
                {goal ? (
                  <div className="col-span-full flex flex-wrap items-end gap-2 bg-blue-soft p-3 max-sm:flex-col max-sm:items-stretch">
                    <span className="mr-auto flex flex-col">
                      <small className="text-[9px] text-muted">On-chain status</small>
                      <strong>{goal.status}</strong>
                    </span>
                    {goal.status === 'OPEN' && goal.goalType === 'ONE_TIME' ? (
                      <>
                        <ActionButton
                          size="compact"
                          disabled={transactionPending || !canDirectlyControlGoal}
                          onClick={() => void onCloseGoal(goal.id)}
                        >
                          {canDirectlyControlGoal
                            ? 'Sign close · all funds to recipient'
                            : 'Goal controller required'}
                        </ActionButton>
                        <ActionButton
                          variant="danger"
                          size="compact"
                          disabled={transactionPending || !canDirectlyControlGoal}
                          onClick={() => void onCancelGoal(goal.id)}
                        >
                          {canDirectlyControlGoal
                            ? 'Sign cancellation'
                            : 'Goal controller required'}
                        </ActionButton>
                      </>
                    ) : null}
                    {goal.goalType === 'MONTHLY' ? (
                      <div className="basis-full border-t border-line pt-3">
                        <div className="mb-3 grid grid-cols-6 gap-3 text-[10px] max-[900px]:grid-cols-3 max-sm:grid-cols-2">
                          <span>
                            <small className="block text-muted">Current period</small>
                            <strong>
                              #{goal.periods[0]?.periodIndex ?? goal.monthlyPeriodsSettled + 1}
                            </strong>
                          </span>
                          <span>
                            <small className="block text-muted">Policy</small>
                            <strong>{goal.monthlySurplusPolicy?.replaceAll('_', ' ')}</strong>
                          </span>
                          <span>
                            <small className="block text-muted">First settlement</small>
                            <strong>{goal.monthlyFirstSettlementAt?.slice(0, 10) ?? '—'}</strong>
                          </span>
                          <span>
                            <small className="block text-muted">Base day</small>
                            <strong>{goal.monthlySettlementDay ?? '—'}</strong>
                          </span>
                          <span>
                            <small className="block text-muted">PRE carry</small>
                            <strong>{formatUnits(BigInt(goal.preCarryRaw), 18)}</strong>
                          </span>
                          <span>
                            <small className="block text-muted">USDC carry</small>
                            <strong>{formatUnits(BigInt(goal.usdcCarryRaw), 6)}</strong>
                          </span>
                        </div>
                        {goal.status === 'OPEN' ? (
                          <div className="flex flex-wrap gap-2">
                            {!goal.monthlyStopRequestedAt ? (
                              <ActionButton
                                size="compact"
                                disabled={
                                  transactionPending ||
                                  (!canDirectlyControlGoal && !canProposeSafePayout)
                                }
                                onClick={() =>
                                  void onLifecycle(
                                    goal.id,
                                    'SET_MONTHLY_SURPLUS_POLICY',
                                    goal.monthlySurplusPolicy === 'PAYOUT_ALL'
                                      ? 'ROLL_OVER'
                                      : 'PAYOUT_ALL',
                                  )
                                }
                              >
                                Change policy{' '}
                                {canDirectlyControlGoal
                                  ? 'directly'
                                  : safeDelivery === 'MANUAL'
                                    ? 'via JSON'
                                    : 'via Safe'}
                              </ActionButton>
                            ) : null}
                            {!goal.monthlyStopRequestedAt ? (
                              <ActionButton
                                size="compact"
                                disabled={
                                  transactionPending ||
                                  (!canDirectlyControlGoal && !canProposeSafePayout)
                                }
                                onClick={() => void onLifecycle(goal.id, 'REQUEST_MONTHLY_STOP')}
                              >
                                Graceful stop{' '}
                                {canDirectlyControlGoal
                                  ? 'directly'
                                  : safeDelivery === 'MANUAL'
                                    ? 'via JSON'
                                    : 'via Safe'}
                              </ActionButton>
                            ) : (
                              <span className="text-[10px] text-warning">Stop requested</span>
                            )}
                            <ActionButton
                              variant="danger"
                              size="compact"
                              disabled={transactionPending || !canProposeSafePayout}
                              onClick={() => void onLifecycle(goal.id, 'CANCEL_MONTHLY')}
                            >
                              Emergency cancel via {safeDelivery === 'MANUAL' ? 'JSON' : 'Safe'}
                            </ActionButton>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    {goal.goalType === 'MONTHLY' ||
                    goal.status === 'CLOSED' ||
                    goal.status === 'CANCELLED'
                      ? (['PRE', 'USDC'] as const).flatMap((asset) => {
                          const kinds: Array<'EXPENSE' | 'CANCELLED_FUNDS'> = [
                            'EXPENSE',
                            ...(goal.status === 'CANCELLED' ? (['CANCELLED_FUNDS'] as const) : []),
                          ];
                          return kinds.map((kind) => {
                            const submitting = safeProposals.find(
                              (proposal) =>
                                proposal.goalId === goal.id &&
                                proposal.asset === asset &&
                                proposal.kind === kind &&
                                proposal.status === 'SUBMITTING' &&
                                proposal.payoutStatus === 'PROPOSED',
                            );
                            const amount = submitting
                              ? BigInt(submitting.amountRaw)
                              : available(goal, asset, kind, safeProposals);
                            if (amount === 0n) return null;
                            return (
                              <ActionButton
                                size="compact"
                                key={`${asset}-${kind}`}
                                disabled={transactionPending || !canProposeSafePayout}
                                onClick={() => void onRelease(goal.id, asset, kind, amount)}
                              >
                                {submitting
                                  ? safeDelivery === 'MANUAL'
                                    ? 'Replace with manual JSON'
                                    : 'Retry Safe submission'
                                  : canProposeSafePayout
                                    ? kind === 'EXPENSE'
                                      ? safeDelivery === 'MANUAL'
                                        ? 'Prepare recipient payout JSON'
                                        : 'Send recipient payout to Safe'
                                      : safeDelivery === 'MANUAL'
                                        ? 'Prepare treasury payout JSON'
                                        : 'Send cancelled funds to treasury Safe'
                                    : 'Safe setup required'}{' '}
                                · {formatUnits(amount, asset === 'PRE' ? 18 : 6)} {asset}
                              </ActionButton>
                            );
                          });
                        })
                      : null}
                  </div>
                ) : null}
              </article>
            );
          })}
        </section>
      ))}
    </div>
  );
}
