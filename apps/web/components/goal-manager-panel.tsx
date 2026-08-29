'use client';

import { type FormEvent, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Clock3,
  ExternalLink,
  LoaderCircle,
  Pin,
  PinOff,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { getAddress, isAddress } from 'viem';
import type {
  AdminGoalManagerEntry,
  AdminGoalManagerWorkspace,
  AdminSafeGoalManagerProposal,
} from '@/lib/admin-workspace-types';
import { ActionButton } from './action-button';
import { ConfirmationDialog } from './confirmation-dialog';
import { compactFormLabelClass, formLabelTextClass, textInputClass } from './form-control-classes';

const pendingProposalStatuses = new Set([
  'SUBMITTING',
  'AWAITING_CONFIRMATIONS',
  'READY_TO_EXECUTE',
]);
const zeroAddress = '0x0000000000000000000000000000000000000000';

function isManagerAddress(value: string) {
  return isAddress(value) && getAddress(value).toLowerCase() !== zeroAddress;
}

function proposalCopy(proposal: AdminSafeGoalManagerProposal) {
  if (proposal.failureReason) return proposal.failureReason;
  if (proposal.status === 'SUBMITTING') return 'Publishing the manager batch to Safe';
  if (proposal.status === 'AWAITING_CONFIRMATIONS') {
    return `${proposal.confirmations} of ${proposal.threshold} approvals collected`;
  }
  if (proposal.status === 'READY_TO_EXECUTE') return 'Approval threshold reached · execute in Safe';
  if (proposal.status === 'EXECUTED') return 'Executed · waiting for confirmed indexer events';
  return 'This proposal must not be executed';
}

function statusCopy(entry: AdminGoalManagerEntry) {
  if (entry.status === 'NEEDS_ADD') return 'Needs on-chain addition';
  if (entry.status === 'NEEDS_REMOVE') return 'Needs on-chain removal';
  return 'Synced';
}

interface GoalManagerPanelProps {
  workspace: AdminGoalManagerWorkspace;
  canManage: boolean;
  pending: boolean;
  onSync: () => Promise<void>;
  onUpdate: (address: string, enabled: boolean) => Promise<boolean>;
}

export function GoalManagerPanel({
  workspace,
  canManage,
  pending,
  onSync,
  onUpdate,
}: GoalManagerPanelProps) {
  const [managerAddress, setManagerAddress] = useState('');
  const [managerToRemove, setManagerToRemove] = useState<AdminGoalManagerEntry | null>(null);
  const [managerAction, setManagerAction] = useState<string | null>(null);
  const [confirmSync, setConfirmSync] = useState(false);
  const [syncPending, setSyncPending] = useState(false);
  const latestProposal = workspace.latestProposal;
  const proposalIsPending = Boolean(
    latestProposal && pendingProposalStatuses.has(latestProposal.status),
  );
  const proposalNeedsReplacement = Boolean(
    proposalIsPending && latestProposal?.failureReason?.includes('Cancel or replace'),
  );
  const riskySyncEntries = workspace.entries.filter(
    (entry) => entry.status === 'NEEDS_REMOVE' && entry.openGoalCount > 0,
  );
  const riskyOpenGoalCount = riskySyncEntries.reduce(
    (total, entry) => total + entry.openGoalCount,
    0,
  );
  const syncBusy = syncPending;

  async function synchronize() {
    setSyncPending(true);
    try {
      await onSync();
    } finally {
      setSyncPending(false);
    }
  }

  async function addManager(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isManagerAddress(managerAddress)) return;
    setManagerAction('add');
    try {
      if (await onUpdate(getAddress(managerAddress), true)) setManagerAddress('');
    } finally {
      setManagerAction(null);
    }
  }

  async function updateManager(address: string, enabled: boolean) {
    setManagerAction(address.toLowerCase());
    try {
      return await onUpdate(address, enabled);
    } finally {
      setManagerAction(null);
    }
  }

  async function removeManager() {
    if (!managerToRemove) return;
    if (await updateManager(managerToRemove.address, false)) setManagerToRemove(null);
  }

  return (
    <section className="mt-7 border-y border-line py-5" aria-labelledby="goal-managers-title">
      <div className="flex items-start justify-between gap-5 max-sm:flex-col">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center bg-blue-soft text-blue">
            <Users size={21} />
          </span>
          <div className="min-w-0">
            <span className="font-mono text-[10px] tracking-[.06em] text-blue uppercase">
              Contract authority
            </span>
            <h2 className="mt-1 mb-1 text-xl" id="goal-managers-title">
              Goal managers
            </h2>
            <p className="m-0 text-[13px] text-muted">
              Safe owners plus manually pinned addresses · up to {workspace.maxOpenGoalsPerManager}{' '}
              open goals per manager
            </p>
          </div>
        </div>
        {canManage ? (
          <ActionButton
            size="compact"
            icon={
              syncBusy ? (
                <LoaderCircle className="animate-spin" size={14} />
              ) : (
                <ShieldCheck size={14} />
              )
            }
            disabled={pending || syncBusy || proposalIsPending || workspace.inSync}
            onClick={() => {
              if (riskySyncEntries.length) setConfirmSync(true);
              else void synchronize();
            }}
          >
            {syncBusy
              ? 'Synchronizing…'
              : workspace.inSync
                ? 'Safe owners synced'
                : 'Sync Safe owners'}
          </ActionButton>
        ) : null}
      </div>

      {latestProposal ? (
        <div
          className={`mt-4 flex flex-wrap items-center justify-between gap-3 border-l-2 px-3 py-2.5 text-xs ${
            proposalNeedsReplacement ||
            latestProposal.status === 'STALE' ||
            latestProposal.status === 'FAILED'
              ? 'border-danger bg-danger/5'
              : 'border-blue bg-blue-soft'
          }`}
        >
          <span className="inline-flex min-w-0 items-start gap-2">
            {proposalNeedsReplacement ||
            latestProposal.status === 'STALE' ||
            latestProposal.status === 'FAILED' ? (
              <AlertTriangle className="mt-0.5 shrink-0 text-danger" size={15} />
            ) : latestProposal.status === 'EXECUTED' ? (
              <Check className="mt-0.5 shrink-0 text-blue" size={15} />
            ) : (
              <Clock3 className="mt-0.5 shrink-0 text-blue" size={15} />
            )}
            <span>
              <strong className="block">
                {proposalNeedsReplacement
                  ? 'Settings changed — replace this proposal in Safe'
                  : latestProposal.status === 'STALE'
                    ? 'Safe owners changed — do not execute this proposal'
                    : 'Goal manager Safe proposal'}
              </strong>
              <small className="mt-0.5 block text-[10px] text-muted">
                {proposalCopy(latestProposal)}
              </small>
            </span>
          </span>
          <a
            className="inline-flex min-h-8 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-navy bg-white px-2 text-[10px] text-navy no-underline transition-[color,background-color,border-color,transform] duration-150 hover:translate-x-0.5 hover:border-blue hover:bg-blue-soft"
            href={latestProposal.queueUrl}
            target="_blank"
            rel="noreferrer"
          >
            Open Safe approvals <ExternalLink size={14} />
          </a>
        </div>
      ) : null}

      {syncBusy ? (
        <div
          className="mt-4 flex items-center gap-2 border-l-2 border-blue bg-blue-soft px-3 py-2.5 text-xs"
          role="status"
          aria-live="polite"
        >
          <LoaderCircle className="shrink-0 animate-spin text-blue" size={16} />
          Preparing Safe owner synchronization. The wallet prompt may take a moment to appear…
        </div>
      ) : null}

      <div className="mt-5 divide-y divide-line border-y border-line">
        {workspace.entries.map((entry) => (
          <div className="group py-3" key={entry.address}>
            <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-5 transition-transform duration-180 group-hover:translate-x-1 max-md:grid-cols-[minmax(0,1fr)_auto] max-sm:grid-cols-1">
              <div className="min-w-0">
                <code className="block break-all font-mono text-[12px] text-navy">
                  {entry.address}
                </code>
                <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted">
                  {entry.safeOwner ? <span>Safe owner</span> : null}
                  {entry.manualPinned ? <span>Manual pin</span> : null}
                  {entry.legacy ? <span>Legacy manager</span> : null}
                  <span>{entry.openGoalCount} open goals</span>
                </span>
              </div>
              <span
                className={`font-mono text-[9px] tracking-[.04em] uppercase ${
                  entry.status === 'SYNCED' ? 'text-muted' : 'text-danger'
                }`}
              >
                {statusCopy(entry)}
              </span>
              {canManage ? (
                <div className="flex justify-end max-md:col-start-2 max-sm:col-start-1 max-sm:justify-start">
                  {entry.safeOwner ? (
                    <ActionButton
                      size="compact"
                      icon={
                        managerAction === entry.address.toLowerCase() ? (
                          <LoaderCircle className="animate-spin" size={13} />
                        ) : entry.manualPinned ? (
                          <PinOff size={13} />
                        ) : (
                          <Pin size={13} />
                        )
                      }
                      disabled={pending || Boolean(managerAction) || proposalIsPending}
                      onClick={() => void updateManager(entry.address, !entry.manualPinned)}
                    >
                      {managerAction === entry.address.toLowerCase()
                        ? 'Preparing wallet…'
                        : entry.manualPinned
                          ? 'Remove manual pin'
                          : 'Keep after Safe removal'}
                    </ActionButton>
                  ) : entry.desired || entry.actual ? (
                    <ActionButton
                      variant="danger"
                      size="compact"
                      disabled={
                        pending ||
                        Boolean(managerAction) ||
                        proposalIsPending ||
                        entry.status === 'NEEDS_REMOVE'
                      }
                      onClick={() => setManagerToRemove(entry)}
                    >
                      Remove
                    </ActionButton>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        ))}
        {!workspace.entries.length ? (
          <p className="m-0 py-4 text-xs text-muted">No goal manager addresses are tracked yet.</p>
        ) : null}
      </div>

      {canManage ? (
        <form
          className="mt-5 grid grid-cols-[1fr_auto] gap-2 max-sm:grid-cols-1"
          onSubmit={(event) => void addManager(event)}
        >
          <label className={compactFormLabelClass}>
            <span className={formLabelTextClass}>Manually pin an address</span>
            <input
              className={`${textInputClass} !min-h-8 py-1 font-mono text-xs`}
              value={managerAddress}
              placeholder="0x…"
              autoComplete="off"
              spellCheck={false}
              aria-describedby={
                managerAddress && !isManagerAddress(managerAddress)
                  ? 'goal-manager-address-error'
                  : undefined
              }
              aria-invalid={Boolean(managerAddress && !isManagerAddress(managerAddress))}
              onChange={(event) => setManagerAddress(event.target.value.trim())}
            />
            {managerAddress && !isManagerAddress(managerAddress) ? (
              <small
                id="goal-manager-address-error"
                className="text-[11px] text-danger"
                role="alert"
              >
                Enter a valid non-zero Ethereum address beginning with 0x.
              </small>
            ) : null}
          </label>
          <ActionButton
            className="self-end text-[11px]"
            type="submit"
            size="compact"
            variant="primary"
            icon={
              managerAction === 'add' ? (
                <LoaderCircle className="animate-spin" size={13} />
              ) : undefined
            }
            disabled={
              pending ||
              Boolean(managerAction) ||
              proposalIsPending ||
              !isManagerAddress(managerAddress)
            }
          >
            {managerAction === 'add' ? 'Preparing wallet…' : 'Add manager'}
          </ActionButton>
          {managerAction === 'add' ? (
            <span
              className="col-span-full flex items-center gap-2 border-l-2 border-blue bg-blue-soft px-3 py-2.5 text-xs"
              role="status"
              aria-live="polite"
            >
              <LoaderCircle className="shrink-0 animate-spin text-blue" size={16} />
              Preparing the manager update. The wallet prompt may take a moment to appear…
            </span>
          ) : null}
        </form>
      ) : null}

      <ConfirmationDialog
        open={confirmSync}
        title="Synchronize Safe owners?"
        description={`This will remove ${riskySyncEntries.length} former Safe owner${riskySyncEntries.length === 1 ? '' : 's'} with ${riskyOpenGoalCount} open goal${riskyOpenGoalCount === 1 ? '' : 's'} in total. Those goals remain open and the Safe can still close them as contract owner.`}
        confirmLabel="Prepare sync"
        pending={pending || syncBusy}
        onCancel={() => setConfirmSync(false)}
        onConfirm={() => {
          void synchronize().finally(() => setConfirmSync(false));
        }}
      />
      <ConfirmationDialog
        open={Boolean(managerToRemove)}
        title="Remove this goal manager?"
        description={
          managerToRemove?.openGoalCount
            ? `This manager still has ${managerToRemove.openGoalCount} open goal${managerToRemove.openGoalCount === 1 ? '' : 's'}. The goals remain open and the Safe can still close them as contract owner.`
            : 'The address will lose GOAL_MANAGER after the prepared transaction is confirmed on-chain.'
        }
        confirmLabel="Remove manager"
        pending={pending || Boolean(managerAction)}
        onCancel={() => setManagerToRemove(null)}
        onConfirm={() => void removeManager()}
      />
    </section>
  );
}
