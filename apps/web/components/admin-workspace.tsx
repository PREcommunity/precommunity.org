'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CircleAlert, ExternalLink, LoaderCircle, RefreshCw } from 'lucide-react';
import { useAdminWorkspace } from '@/hooks/use-admin-workspace';
import { useWalletSession } from '@/hooks/use-wallet-session';
import { hasAdminWorkspaceRole } from '@/lib/admin-access';
import { availableAdminTabs, resolveAdminTab } from '@/lib/admin-tabs';
import { canAccessAdmin } from '@/lib/session-access';
import { ActionButton } from './action-button';
import { AdminCreationForms } from './admin-creation-forms';
import { AdminGoalList } from './admin-goal-list';
import { CommunityModerationPanel } from './community-moderation-panel';
import { ConfirmationDialog } from './confirmation-dialog';
import { ForumModerationPanel } from './forum-moderation-panel';
import { GoalManagerPanel } from './goal-manager-panel';
import { KeywordMarketFeaturePanel } from './keyword-market-feature-panel';
import { SafePayoutPanel } from './safe-payout-panel';
import { SafeLifecyclePanel } from './safe-lifecycle-panel';
import { SafeManualTransactionDialog } from './safe-manual-transaction-dialog';
import { StatusNotice } from './status-notice';

const accessStateClass =
  'my-7 flex min-h-[220px] flex-col items-center justify-center border-y border-line px-[18px] py-8 text-center';
const accessHeadingClass = 'mt-2.5 mb-1 text-2xl';
const accessButtonClass = 'mt-4 cursor-pointer border border-navy bg-navy px-3 py-2 text-white';

export function AdminWorkspace({ requestedTab }: { requestedTab?: string }) {
  const router = useRouter();
  const admin = useAdminWorkspace();
  const { sessionReady, sessionRoles } = useWalletSession();
  const hasWorkspaceAccess = admin.principal ? hasAdminWorkspaceRole(admin.principal) : false;
  const adminRoles = admin.principal?.roles ?? sessionRoles;
  const hasAdminAccess = canAccessAdmin(adminRoles);
  const canModerateCommunity = adminRoles.some(
    (role) => role === 'SUPER_ADMIN' || role === 'CONTENT_ADMIN',
  );
  const tabs = availableAdminTabs(adminRoles);
  const activeTab = resolveAdminTab(requestedTab ?? null, tabs);

  useEffect(() => {
    if (admin.state === 'loading' || (!sessionReady && !admin.principal)) return;
    if (requestedTab === activeTab) return;
    router.replace(`/admin?tab=${activeTab}`, { scroll: false });
  }, [
    activeTab,
    admin.principal,
    admin.state,
    adminRoles.length,
    requestedTab,
    router,
    sessionReady,
  ]);

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
            admin.refreshPending ? (
              <LoaderCircle className="animate-spin" size={15} />
            ) : (
              <RefreshCw size={15} />
            )
          }
          disabled={admin.refreshPending}
          onClick={() => void admin.refreshData()}
        >
          {admin.refreshPending ? 'Refreshing Safe data…' : 'Refresh Safe data'}
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

      <nav
        className="mt-7 overflow-x-auto overflow-y-hidden border-b border-navy"
        aria-label="Admin sections"
      >
        <div className="flex min-w-max gap-1">
          {tabs.map((tab) => (
            <Link
              className={`-mb-px flex min-h-11 items-center border-b-2 px-3.5 text-xs font-bold transition-colors ${
                tab.id === activeTab
                  ? 'border-blue text-navy'
                  : 'border-transparent text-muted hover:border-line hover:text-navy dark:hover:text-white'
              }`}
              href={`/admin?tab=${tab.id}`}
              scroll={false}
              aria-current={tab.id === activeTab ? 'page' : undefined}
              key={tab.id}
            >
              {tab.label}
            </Link>
          ))}
        </div>
      </nav>

      {hasAdminAccess && activeTab === 'keyword-marketplace' ? (
        <KeywordMarketFeaturePanel
          canManage={adminRoles.includes('SUPER_ADMIN')}
          canModerate={canModerateCommunity}
        />
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
          {activeTab === 'operations' ? (
            <>
              {admin.principal ? (
                <SafePayoutPanel
                  principal={admin.principal}
                  status={admin.safeStatus}
                  proposals={admin.safeProposals}
                  pending={admin.transactionPending}
                  delivery={admin.safeDelivery}
                  onDeliveryChange={admin.setSafeDelivery}
                  onTransferOwnership={admin.transferOwnershipToSafe}
                  onProposeOwnershipAcceptance={admin.proposeOwnershipAcceptance}
                  onReopenManualPayout={admin.reopenManualPayout}
                  onCancelManualPayout={admin.cancelManualPayout}
                />
              ) : null}
              {admin.goalManagers && hasWorkspaceAccess ? (
                <GoalManagerPanel
                  workspace={admin.goalManagers}
                  canManage={Boolean(admin.principal?.roles.some((role) => role === 'SUPER_ADMIN'))}
                  pending={admin.transactionPending}
                  delivery={admin.safeDelivery}
                  onSync={admin.syncGoalManagers}
                  onUpdate={admin.updateGoalManager}
                />
              ) : null}
              {hasWorkspaceAccess && admin.safeGoalActions.length ? (
                <SafeLifecyclePanel proposals={admin.safeGoalActions} />
              ) : null}
            </>
          ) : null}
          {activeTab === 'forum' && hasWorkspaceAccess && canModerateCommunity ? (
            <>
              <ForumModerationPanel />
              <CommunityModerationPanel onDraftCreated={admin.load} />
            </>
          ) : null}
          {activeTab === 'goals' && hasWorkspaceAccess ? (
            <>
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
                onPreviewSharingChange={admin.setPreviewSharing}
                canSharePreviews={canModerateCommunity}
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
                  (admin.safeDelivery === 'MANUAL' || admin.safeStatus?.serviceConfigured),
                )}
                safeDelivery={admin.safeDelivery}
              />
            </>
          ) : null}
        </>
      ) : null}
      {admin.principal ? (
        <SafeManualTransactionDialog
          request={admin.manualSafeExport}
          ownerAddress={admin.principal.address}
          onClose={admin.closeManualSafeExport}
        />
      ) : null}
      <ConfirmationDialog
        open={Boolean(admin.manualReplacement)}
        title="Confirm the proposal is absent from Safe"
        description="Open the Safe queue and check the exact transaction before continuing. Confirm only if the earlier API submission is not waiting for signatures and is not ready to execute; otherwise exporting a replacement could duplicate it."
        confirmLabel="I checked — export JSON"
        pending={admin.manualReplacementPending}
        onCancel={admin.cancelManualReplacement}
        onConfirm={() => void admin.confirmManualReplacement()}
      />
    </div>
  );
}
