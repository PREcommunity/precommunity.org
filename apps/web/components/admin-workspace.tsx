'use client';

import { CircleAlert, ExternalLink, LoaderCircle, RefreshCw } from 'lucide-react';
import { useAdminWorkspace } from '@/hooks/use-admin-workspace';
import { useWalletSession } from '@/hooks/use-wallet-session';
import { hasAdminWorkspaceRole } from '@/lib/admin-access';
import { canAccessAdmin } from '@/lib/session-access';
import { ActionButton } from './action-button';
import { AdminCreationForms } from './admin-creation-forms';
import { AdminGoalList } from './admin-goal-list';
import { CommunityModerationPanel } from './community-moderation-panel';
import { ForumModerationPanel } from './forum-moderation-panel';
import { GoalManagerPanel } from './goal-manager-panel';
import { KeywordMarketFeaturePanel } from './keyword-market-feature-panel';
import { SafePayoutPanel } from './safe-payout-panel';
import { SafeLifecyclePanel } from './safe-lifecycle-panel';
import { StatusNotice } from './status-notice';

const accessStateClass =
  'my-7 flex min-h-[220px] flex-col items-center justify-center border-y border-line px-[18px] py-8 text-center';
const accessHeadingClass = 'mt-2.5 mb-1 text-2xl';
const accessButtonClass = 'mt-4 cursor-pointer border border-navy bg-navy px-3 py-2 text-white';

export function AdminWorkspace() {
  const admin = useAdminWorkspace();
  const { sessionRoles } = useWalletSession();
  const hasWorkspaceAccess = admin.principal ? hasAdminWorkspaceRole(admin.principal) : false;
  const adminRoles = admin.principal?.roles ?? sessionRoles;
  const hasAdminAccess = canAccessAdmin(adminRoles);

  return (
    <div className="px-[var(--page-pad)] pt-7 pb-[60px]">
      <section className="flex items-end justify-between gap-6 max-sm:flex-col max-sm:items-stretch">
        <div className="max-w-[780px]">
          <span className="inline-flex items-center gap-1.5 font-mono text-[11px] tracking-[.05em] text-blue uppercase">
            Restricted · administrator access
          </span>
          <h1 className="mt-2.5 mb-2 text-[clamp(30px,4vw,42px)] leading-[1.05] tracking-[-.04em]">
            Admin
          </h1>
          <p className="m-0 max-w-[760px] text-muted">
            Administrative tools are available only to authorized administrators.
          </p>
        </div>
        <ActionButton
          icon={
            admin.state === 'loading' ? (
              <LoaderCircle className="animate-spin" size={15} />
            ) : (
              <RefreshCw size={15} />
            )
          }
          disabled={admin.state === 'loading'}
          onClick={() => void admin.refreshData()}
        >
          {admin.state === 'loading' ? 'Refreshing…' : 'Refresh data'}
        </ActionButton>
      </section>

      <StatusNotice notice={admin.notice} />
      {admin.proofHash ? (
        <a
          className="my-3 flex items-center gap-2 border-l-2 border-blue bg-blue-soft px-3 py-2.5 text-xs"
          href={admin.transactionExplorerUrl ?? '#'}
          target="_blank"
          rel="noreferrer"
        >
          Transaction proof {admin.proofHash.slice(0, 10)}… <ExternalLink size={14} />
        </a>
      ) : null}
      {admin.transactionPending ? (
        <div className="my-3 flex items-center gap-2 border-l-2 border-blue bg-blue-soft px-3 py-2.5 text-xs">
          <LoaderCircle className="animate-spin" size={17} /> Waiting for wallet or receipt…
        </div>
      ) : null}

      {hasAdminAccess ? (
        <KeywordMarketFeaturePanel canManage={adminRoles.includes('SUPER_ADMIN')} />
      ) : null}

      {admin.state === 'idle' ? (
        <div className={accessStateClass}>
          <CircleAlert size={24} />
          <h2 className={accessHeadingClass}>Connect an authorized wallet</h2>
          <p className="text-muted">Sign in with the wallet control above, then check access.</p>
          <button className={accessButtonClass} onClick={() => void admin.load()}>
            Check access
          </button>
        </div>
      ) : null}
      {admin.state === 'loading' ? (
        <div className={accessStateClass}>
          <LoaderCircle className="animate-spin" />
          <h2 className={accessHeadingClass}>Loading workspace</h2>
        </div>
      ) : null}
      {admin.state === 'unauthorized' ? (
        <div className={accessStateClass}>
          <CircleAlert size={24} />
          <h2 className={accessHeadingClass}>Connect an authorized wallet</h2>
          <p className="text-muted">
            This workspace requires a confirmed contract authority or an assigned application role.
          </p>
          <button className={accessButtonClass} onClick={() => void admin.load()}>
            Check again
          </button>
        </div>
      ) : null}
      {admin.state === 'error' ? (
        <div className={accessStateClass}>
          <CircleAlert size={24} />
          <h2 className={accessHeadingClass}>Admin unavailable</h2>
          <p className="text-muted">Couldn’t load the data.</p>
          <button className={accessButtonClass} onClick={() => void admin.load()}>
            Retry
          </button>
        </div>
      ) : null}

      {admin.state === 'ready' && admin.workspace ? (
        <>
          {admin.principal ? (
            <SafePayoutPanel
              principal={admin.principal}
              status={admin.safeStatus}
              proposals={admin.safeProposals}
              pending={admin.transactionPending}
              onTransferOwnership={admin.transferOwnershipToSafe}
              onProposeOwnershipAcceptance={admin.proposeOwnershipAcceptance}
            />
          ) : null}
          {admin.goalManagers && hasWorkspaceAccess ? (
            <GoalManagerPanel
              workspace={admin.goalManagers}
              canManage={Boolean(admin.principal?.roles.some((role) => role === 'SUPER_ADMIN'))}
              pending={admin.transactionPending}
              onSync={admin.syncGoalManagers}
              onUpdate={admin.updateGoalManager}
            />
          ) : null}
          {hasWorkspaceAccess && admin.safeGoalActions.length ? (
            <SafeLifecyclePanel proposals={admin.safeGoalActions} />
          ) : null}
          {hasWorkspaceAccess ? (
            <>
              {admin.principal?.roles.some(
                (role) => role === 'SUPER_ADMIN' || role === 'CONTENT_ADMIN',
              ) ? (
                <ForumModerationPanel />
              ) : null}
              {admin.principal?.roles.some(
                (role) => role === 'SUPER_ADMIN' || role === 'CONTENT_ADMIN',
              ) ? (
                <CommunityModerationPanel onDraftCreated={admin.load} />
              ) : null}
              <AdminCreationForms
                workspace={admin.workspace}
                onCreateSubproject={admin.createSubproject}
                onCreateGoal={admin.createGoal}
              />
              <AdminGoalList
                workspace={admin.workspace}
                transactionPending={admin.transactionPending}
                onPublish={admin.publish}
                onUpdateDraft={admin.updateDraft}
                onCloseGoal={admin.closeGoal}
                onCancelGoal={admin.cancelGoal}
                onLifecycle={admin.goalLifecycle}
                onRelease={admin.release}
                safeProposals={admin.safeProposals}
                canManageGoals={Boolean(
                  admin.principal?.chainAuthorities.some(
                    (authority) => authority === 'OWNER' || authority === 'GOAL_MANAGER',
                  ),
                )}
                currentAddress={admin.principal?.address}
                chainAuthorities={admin.principal?.chainAuthorities ?? []}
                canProposeSafePayout={Boolean(
                  admin.principal?.safeOwner &&
                  admin.safeStatus?.safeOwner &&
                  admin.safeStatus?.isEscrowOwner &&
                  admin.safeStatus?.serviceConfigured,
                )}
              />
            </>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
