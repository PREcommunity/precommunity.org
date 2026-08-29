'use client';

import { useState } from 'react';
import { AlertTriangle, Check, Clock3, ExternalLink, ShieldCheck, Users } from 'lucide-react';
import { formatUnits } from 'viem';
import type {
  AdminSafePayoutProposal,
  AdminSafeProposalStatus,
  AdminSafeStatus,
  AdminSessionPrincipal,
} from '@/lib/admin-workspace-types';
import { activeExplorerTransaction } from '@/lib/deployment';
import { ActionButton } from './action-button';
import { ConfirmationDialog } from './confirmation-dialog';

const statusCopy: Record<AdminSafeProposalStatus, string> = {
  SUBMITTING: 'Publishing to Safe',
  AWAITING_CONFIRMATIONS: 'Waiting for approvals',
  READY_TO_EXECUTE: 'Ready to execute',
  EXECUTED: 'Executed',
  STALE: 'Replaced in Safe',
  FAILED: 'Needs attention',
};

function shortAddress(value: string) {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function proposalDetail(proposal: AdminSafePayoutProposal) {
  if (proposal.status === 'SUBMITTING') {
    return proposal.failureReason ?? 'Confirming the proposal with Safe Transaction Service';
  }
  if (proposal.status === 'AWAITING_CONFIRMATIONS') {
    return `${proposal.confirmations} of ${proposal.threshold} approvals collected`;
  }
  if (proposal.status === 'READY_TO_EXECUTE') return 'All required approvals are collected';
  if (proposal.status === 'EXECUTED') return 'The payout was sent successfully';
  return proposal.failureReason ?? 'Open Safe to review this proposal';
}

interface SafePayoutPanelProps {
  principal: AdminSessionPrincipal;
  status: AdminSafeStatus | null;
  proposals: AdminSafePayoutProposal[];
  pending: boolean;
  onTransferOwnership: () => Promise<void>;
  onProposeOwnershipAcceptance: () => Promise<void>;
}

export function SafePayoutPanel({
  principal,
  status,
  proposals,
  pending,
  onTransferOwnership,
  onProposeOwnershipAcceptance,
}: SafePayoutPanelProps) {
  const [confirmTransfer, setConfirmTransfer] = useState(false);
  const [confirmAcceptance, setConfirmAcceptance] = useState(false);
  const [migrationPending, setMigrationPending] = useState(false);
  const [acceptancePending, setAcceptancePending] = useState(false);

  async function transferOwnership() {
    setMigrationPending(true);
    await onTransferOwnership();
    setMigrationPending(false);
    setConfirmTransfer(false);
  }

  async function proposeOwnershipAcceptance() {
    setAcceptancePending(true);
    await onProposeOwnershipAcceptance();
    setAcceptancePending(false);
    setConfirmAcceptance(false);
  }

  if (!status) return null;

  if (!status.configured) {
    return (
      <section className="mt-7 border-y border-line py-5">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 shrink-0 text-muted" size={20} />
          <div>
            <h2 className="m-0 text-lg">Safe approvals</h2>
            <p className="mt-1 mb-0 text-[13px] text-muted">
              Safe is not configured for {status.networkName}. Add the environment address and
              Transaction Service access before enabling payouts.
            </p>
          </div>
        </div>
      </section>
    );
  }

  const canTransfer =
    !status.isEscrowOwner &&
    !status.isPendingEscrowOwner &&
    status.serviceConfigured &&
    principal.chainAuthorities.includes('OWNER') &&
    !status.error;
  const canProposeAcceptance =
    status.isPendingEscrowOwner &&
    !status.ownershipAcceptance &&
    status.serviceConfigured &&
    status.safeOwner &&
    !status.error;
  const queueUrl = status.queueUrl ?? proposals[0]?.queueUrl;

  return (
    <section className="mt-7 border-t border-navy py-5" aria-labelledby="safe-approvals-title">
      <div className="flex items-start justify-between gap-5 max-sm:flex-col">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center bg-blue-soft text-blue">
            <ShieldCheck size={21} />
          </span>
          <div className="min-w-0">
            <span className="font-mono text-[10px] tracking-[.06em] text-blue uppercase">
              {status.network === 'base-sepolia' ? 'Testnet · ' : ''}Safe Wallet
            </span>
            <h2 className="mt-1 mb-1 text-xl" id="safe-approvals-title">
              Payout approvals
            </h2>
            <p className="m-0 text-[13px] text-muted">
              {status.address ? shortAddress(status.address) : 'Configured Safe'}
              {status.threshold && status.owners
                ? ` · ${status.threshold} of ${status.owners.length} owners required`
                : ''}
            </p>
          </div>
        </div>
        {queueUrl ? (
          <a
            className="inline-flex min-h-8 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-navy bg-white px-2 text-[10px] text-navy no-underline transition-[color,background-color,border-color,transform] duration-150 hover:translate-x-0.5 hover:border-blue hover:bg-blue-soft"
            href={queueUrl}
            target="_blank"
            rel="noreferrer"
          >
            Open Safe approvals <ExternalLink size={14} />
          </a>
        ) : null}
      </div>

      {status.error ? (
        <div className="mt-4 flex items-start gap-2 border-l-2 border-danger bg-danger/5 px-3 py-2.5 text-xs">
          <AlertTriangle className="mt-0.5 shrink-0 text-danger" size={16} />
          <span>{status.error}</span>
        </div>
      ) : status.isEscrowOwner ? (
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 bg-blue-soft px-3 py-2.5 text-xs">
          <span className="inline-flex items-center gap-1.5 font-medium text-navy">
            <Check size={15} className="text-blue" /> Safe controls payouts
          </span>
          <span className="inline-flex items-center gap-1.5 text-muted">
            <Users size={14} />
            {status.safeOwner
              ? 'Your wallet can create goals'
              : 'Connect a Safe owner wallet to create a goal'}
          </span>
          {!status.serviceConfigured ? (
            <span className="text-danger">Transaction Service access is missing</span>
          ) : null}
        </div>
      ) : status.isPendingEscrowOwner ? (
        <div className="mt-4 grid grid-cols-[1fr_auto] items-center gap-5 bg-blue-soft px-4 py-3 max-sm:grid-cols-1">
          <div>
            <strong className="text-sm">
              {status.ownershipAcceptance?.readyToExecute
                ? 'Safe acceptance is ready'
                : status.ownershipAcceptance
                  ? 'Waiting for Safe approvals'
                  : 'Safe acceptance required'}
            </strong>
            <p className="mt-1 mb-0 text-xs leading-relaxed text-muted">
              {status.ownershipAcceptance
                ? status.ownershipAcceptance.readyToExecute
                  ? 'The approval threshold is complete. Execute acceptOwnership in Safe Wallet to finish the migration.'
                  : `${status.ownershipAcceptance.confirmations} of ${status.ownershipAcceptance.threshold} approvals collected for acceptOwnership.`
                : 'The first transfer step is confirmed. Send acceptOwnership to Safe, then collect the required approvals and execute it.'}
            </p>
          </div>
          {canProposeAcceptance ? (
            <ActionButton
              variant="primary"
              disabled={pending}
              onClick={() => setConfirmAcceptance(true)}
            >
              Send acceptance to Safe
            </ActionButton>
          ) : null}
          {!status.safeOwner && !status.ownershipAcceptance ? (
            <span className="text-xs text-danger">
              Connect a Safe owner wallet to create the acceptance proposal.
            </span>
          ) : null}
          {!status.serviceConfigured ? (
            <span className="text-xs text-danger">
              Safe Transaction Service is required to publish the acceptance proposal.
            </span>
          ) : null}
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-[1fr_auto] items-center gap-5 bg-blue-soft px-4 py-3 max-sm:grid-cols-1">
          <div>
            <strong className="text-sm">One-time ownership migration</strong>
            <p className="mt-1 mb-0 text-xs leading-relaxed text-muted">
              Payouts stay disabled until the escrow owner is changed to this Safe.
              {status.goalManagerReady
                ? ' A direct goal manager is confirmed, so routine goal operations can remain simple.'
                : ' Confirm a direct goal manager first so routine goal operations remain available.'}
            </p>
          </div>
          {canTransfer ? (
            <ActionButton
              variant="primary"
              disabled={pending || !status.goalManagerReady}
              onClick={() => setConfirmTransfer(true)}
            >
              Transfer control to Safe
            </ActionButton>
          ) : null}
          {!status.serviceConfigured ? (
            <span className="text-xs text-danger">
              Verify Transaction Service access before transferring control.
            </span>
          ) : null}
        </div>
      )}

      {proposals.length ? (
        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="m-0 text-sm">Recent payouts</h3>
            <span className="font-mono text-[9px] text-muted uppercase">Safe queue</span>
          </div>
          <div className="divide-y divide-line border-t border-line">
            {proposals.slice(0, 8).map((proposal) => (
              <div
                className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-4 py-3 max-sm:grid-cols-[1fr_auto]"
                key={proposal.id}
              >
                <span className="min-w-0">
                  <strong className="block truncate text-[13px]">
                    {proposal.goalTitle ?? 'Payout'} ·{' '}
                    {formatUnits(BigInt(proposal.amountRaw), proposal.asset === 'PRE' ? 18 : 6)}{' '}
                    {proposal.asset}
                  </strong>
                  <small className="mt-0.5 block text-[10px] text-muted">
                    {proposal.kind === 'EXPENSE' ? 'To recipient' : 'To treasury'} · nonce{' '}
                    {proposal.safeNonce}
                  </small>
                </span>
                <span className="text-right max-sm:row-start-2 max-sm:text-left">
                  <strong className="flex items-center justify-end gap-1.5 text-[11px] max-sm:justify-start">
                    {proposal.status === 'EXECUTED' ? <Check size={14} /> : <Clock3 size={14} />}
                    {statusCopy[proposal.status]}
                  </strong>
                  <small className="mt-0.5 block text-[10px] text-muted">
                    {proposalDetail(proposal)}
                  </small>
                </span>
                <a
                  className="inline-flex size-8 items-center justify-center border border-line text-navy hover:border-navy"
                  href={
                    proposal.executionTxHash
                      ? activeExplorerTransaction(proposal.executionTxHash)
                      : proposal.queueUrl
                  }
                  target="_blank"
                  rel="noreferrer"
                  aria-label={
                    proposal.executionTxHash ? 'Open transaction proof' : 'Open proposal in Safe'
                  }
                >
                  <ExternalLink size={13} />
                </a>
              </div>
            ))}
          </div>
        </div>
      ) : status.isEscrowOwner ? (
        <p className="mt-5 mb-0 border-t border-line pt-3 text-xs text-muted">
          No payout proposals yet. A payout will appear here after an owner sends it to Safe.
        </p>
      ) : null}

      <ConfirmationDialog
        open={confirmTransfer}
        title="Transfer escrow control to Safe?"
        description="This is a one-time administrative change. After confirmation, payouts will require the Safe approval threshold and can no longer be sent directly by this wallet."
        confirmLabel="Transfer to Safe"
        pending={migrationPending}
        onCancel={() => setConfirmTransfer(false)}
        onConfirm={() => void transferOwnership()}
      />
      <ConfirmationDialog
        open={confirmAcceptance}
        title="Send ownership acceptance to Safe?"
        description="Your wallet will sign the exact acceptOwnership transaction and publish it to the Safe approval queue. Control changes only after the Safe threshold approves and executes it."
        confirmLabel="Send to Safe"
        pending={acceptancePending}
        onCancel={() => setConfirmAcceptance(false)}
        onConfirm={() => void proposeOwnershipAcceptance()}
      />
    </section>
  );
}
