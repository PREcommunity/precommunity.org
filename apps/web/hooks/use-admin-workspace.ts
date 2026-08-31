'use client';

import { useCallback, useEffect, useState } from 'react';
import Safe, { type Eip1193Provider } from '@safe-global/protocol-kit';
import { OperationType } from '@safe-global/types-kit';
import { isDeploymentConfigured } from '@precommunity/shared';
import { getAddress, type Hex } from 'viem';
import { useAccount, usePublicClient, useSendTransaction, useSwitchChain } from 'wagmi';
import { canAccessSafeOwnershipAcceptance, hasAdminWorkspaceRole } from '@/lib/admin-access';
import { AUTH_CHANGED_EVENT } from '@/lib/auth-events';
import { activeChain, activeDeployment, activeExplorerTransaction } from '@/lib/deployment';
import { ApiError, clientApiJson, clientApiRequest } from '@/lib/http';
import type {
  AdminGoalDraftInput,
  AdminGoalDraftUpdateInput,
  AdminGoalLifecycleKind,
  AdminGoalManagerChangeRequest,
  AdminGoalManagerWorkspace,
  AdminSafeGoalManagerProposal,
  AdminGoalLifecyclePreparation,
  AdminSafeGoalActionProposal,
  AdminSafePayoutIntent,
  AdminSafePayoutProposal,
  AdminSafeOwnershipAcceptance,
  AdminSafeOwnershipAcceptanceRequest,
  AdminSafeProposalSubmission,
  AdminSafeStatus,
  AdminSessionPrincipal,
  AdminSubproject,
  AdminTransactionRequest,
  AdminWorkspaceState,
  ChainAuthority,
} from '@/lib/admin-workspace-types';
import {
  requireMatchingDeployment,
  requireMatchingTransactionDeployment,
  requireSuccessfulReceipt,
} from '@/lib/transactions';
import type { StatusNoticeState } from '@/components/status-notice';

export function useAdminWorkspace() {
  const { address, chainId, connector, isConnected } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { sendTransactionAsync } = useSendTransaction();
  const publicClient = usePublicClient({ chainId: activeChain.id });
  const [workspace, setWorkspace] = useState<AdminSubproject[] | null>(null);
  const [principal, setPrincipal] = useState<AdminSessionPrincipal | null>(null);
  const [safeStatus, setSafeStatus] = useState<AdminSafeStatus | null>(null);
  const [safeProposals, setSafeProposals] = useState<AdminSafePayoutProposal[]>([]);
  const [safeGoalActions, setSafeGoalActions] = useState<AdminSafeGoalActionProposal[]>([]);
  const [goalManagers, setGoalManagers] = useState<AdminGoalManagerWorkspace | null>(null);
  const [state, setState] = useState<AdminWorkspaceState>('idle');
  const [notice, setNotice] = useState<StatusNoticeState | null>(null);
  const [proofHash, setProofHash] = useState('');
  const [transactionPending, setTransactionPending] = useState(false);
  const deploymentReady = isDeploymentConfigured(activeDeployment);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const [nextPrincipal, nextSafeStatus] = await Promise.all([
        clientApiJson<AdminSessionPrincipal>('/v1/auth/me', undefined, 'Session API'),
        clientApiJson<AdminSafeStatus>('/v1/admin/safe/status', undefined, 'Safe status'),
      ]);
      requireMatchingDeployment(nextSafeStatus, activeDeployment);
      const hasWorkspaceAccess = hasAdminWorkspaceRole(nextPrincipal);
      const hasAcceptanceAccess = canAccessSafeOwnershipAcceptance(nextSafeStatus);
      if (!hasWorkspaceAccess && !hasAcceptanceAccess) {
        setPrincipal(null);
        setWorkspace(null);
        setSafeStatus(null);
        setSafeProposals([]);
        setSafeGoalActions([]);
        setGoalManagers(null);
        setState('unauthorized');
        return;
      }
      const canManagePayouts = nextPrincipal.roles.some(
        (role) => role === 'SUPER_ADMIN' || role === 'FINANCE_ADMIN',
      );
      const [nextWorkspace, nextSafeProposals, nextSafeGoalActions, nextGoalManagers] =
        hasWorkspaceAccess
          ? await Promise.all([
              clientApiJson<AdminSubproject[]>('/v1/admin/workspace', undefined, 'Admin workspace'),
              canManagePayouts
                ? clientApiJson<AdminSafePayoutProposal[]>(
                    '/v1/admin/safe-payout-proposals',
                    undefined,
                    'Safe payout queue',
                  )
                : Promise.resolve([]),
              canManagePayouts
                ? clientApiJson<AdminSafeGoalActionProposal[]>(
                    '/v1/admin/safe-goal-action-proposals',
                    undefined,
                    'Safe lifecycle queue',
                  )
                : Promise.resolve([]),
              clientApiJson<AdminGoalManagerWorkspace>(
                '/v1/admin/goal-managers',
                undefined,
                'Goal managers',
              ),
            ])
          : [[], [], [], null];
      setPrincipal(nextPrincipal);
      setWorkspace(nextWorkspace);
      setSafeStatus(nextSafeStatus);
      setSafeProposals(nextSafeProposals);
      setSafeGoalActions(nextSafeGoalActions);
      setGoalManagers(nextGoalManagers);
      setState('ready');
    } catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        setPrincipal(null);
        setWorkspace(null);
        setSafeStatus(null);
        setSafeProposals([]);
        setSafeGoalActions([]);
        setGoalManagers(null);
        setState('unauthorized');
        return;
      }
      setNotice({
        type: 'error',
        message: error instanceof Error ? error.message : 'Could not load the admin data.',
      });
      setState('error');
    }
  }, []);

  useEffect(() => {
    const reloadAfterAuthentication = () => {
      if (isConnected) void load();
    };
    if (isConnected) void load();
    else {
      setPrincipal(null);
      setWorkspace(null);
      setSafeStatus(null);
      setSafeProposals([]);
      setSafeGoalActions([]);
      setGoalManagers(null);
      setState('idle');
    }
    window.addEventListener(AUTH_CHANGED_EVENT, reloadAfterAuthentication);
    return () => window.removeEventListener(AUTH_CHANGED_EVENT, reloadAfterAuthentication);
  }, [isConnected, load]);

  const hasPendingSafeProposal =
    Boolean(safeStatus?.isPendingEscrowOwner && safeStatus.ownershipAcceptance) ||
    safeProposals.some(
      (proposal) =>
        proposal.status === 'SUBMITTING' ||
        proposal.status === 'AWAITING_CONFIRMATIONS' ||
        proposal.status === 'READY_TO_EXECUTE',
    ) ||
    safeGoalActions.some(
      (proposal) =>
        proposal.status === 'SUBMITTING' ||
        proposal.status === 'AWAITING_CONFIRMATIONS' ||
        proposal.status === 'READY_TO_EXECUTE',
    );

  useEffect(() => {
    if (!hasPendingSafeProposal || !principal) return;
    const canManagePayouts = principal.roles.some(
      (role) => role === 'SUPER_ADMIN' || role === 'FINANCE_ADMIN',
    );
    const timer = window.setInterval(() => {
      void Promise.all([
        clientApiJson<AdminSafeStatus>('/v1/admin/safe/status', undefined, 'Safe status'),
        canManagePayouts
          ? clientApiJson<AdminSafePayoutProposal[]>(
              '/v1/admin/safe-payout-proposals',
              undefined,
              'Safe payout queue',
            )
          : Promise.resolve([]),
        canManagePayouts
          ? clientApiJson<AdminSafeGoalActionProposal[]>(
              '/v1/admin/safe-goal-action-proposals',
              undefined,
              'Safe lifecycle queue',
            )
          : Promise.resolve([]),
        hasAdminWorkspaceRole(principal)
          ? clientApiJson<AdminGoalManagerWorkspace>(
              '/v1/admin/goal-managers',
              undefined,
              'Goal managers',
            )
          : Promise.resolve(null),
      ])
        .then(([nextStatus, nextProposals, nextGoalActions, nextGoalManagers]) => {
          requireMatchingDeployment(nextStatus, activeDeployment);
          setSafeStatus(nextStatus);
          setSafeProposals(nextProposals);
          setSafeGoalActions(nextGoalActions);
          setGoalManagers(nextGoalManagers);
        })
        .catch(() => undefined);
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [hasPendingSafeProposal, principal]);

  async function execute(
    request: AdminTransactionRequest,
    label: string,
    allowedAuthorities: ChainAuthority[],
    onConfirmed?: (hash: Hex) => Promise<void>,
  ) {
    if (!deploymentReady) {
      setNotice({
        type: 'error',
        message: 'Deployment manifest is still empty. No transaction can be sent.',
      });
      return;
    }
    if (!address || !principal || address.toLowerCase() !== principal.address.toLowerCase()) {
      setNotice({
        type: 'error',
        message: 'Connect and sign in with the same wallet before signing this transaction.',
      });
      return;
    }
    if (!allowedAuthorities.some((authority) => principal.chainAuthorities.includes(authority))) {
      setNotice({
        type: 'error',
        message: 'This transaction requires a confirmed on-chain contract authority.',
      });
      return;
    }

    try {
      requireMatchingTransactionDeployment(request, activeDeployment);
      if (!publicClient) throw new Error(`${activeDeployment.networkName} RPC is unavailable.`);
      setTransactionPending(true);
      setProofHash('');
      if (chainId !== activeChain.id) await switchChainAsync({ chainId: activeChain.id });
      const hash = await sendTransactionAsync({
        to: getAddress(request.to),
        value: BigInt(request.value),
        data: request.data,
        chainId: activeChain.id,
      });
      setProofHash(hash);
      setNotice({
        type: 'info',
        message: `${label} submitted. Awaiting confirmation and indexing.`,
      });
      requireSuccessfulReceipt(await publicClient.waitForTransactionReceipt({ hash }), label);
      await onConfirmed?.(hash);
      await load();
    } catch (reason) {
      setNotice({
        type: 'error',
        message:
          reason instanceof Error
            ? reason.message.split('\n')[0]!
            : 'Transaction was not submitted.',
      });
    } finally {
      setTransactionPending(false);
    }
  }

  async function createSubproject(input: { name: string; slug: string; description?: string }) {
    try {
      await clientApiRequest(
        '/v1/admin/subprojects',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input),
        },
        'Subproject creation',
      );
      setNotice({ type: 'success', message: 'Subproject created.' });
      await load();
      return true;
    } catch (error) {
      setNotice({
        type: 'error',
        message: error instanceof Error ? error.message : 'Could not create the subproject.',
      });
      return false;
    }
  }

  async function processGoalManagerRequest(
    request: AdminGoalManagerChangeRequest,
    noChainChangeMessage = 'Goal managers are already synchronized.',
  ) {
    if (request.mode === 'NONE') {
      setNotice({ type: 'success', message: noChainChangeMessage });
      await load();
      return true;
    }
    if (request.mode === 'PENDING') {
      setNotice({
        type: 'info',
        message: `A Safe proposal is already waiting for approvals (${request.proposal.confirmations} of ${request.proposal.threshold}).`,
      });
      await load();
      return true;
    }
    if (!deploymentReady) {
      setNotice({ type: 'error', message: 'Deployment manifest is not configured.' });
      return false;
    }
    if (!address || !principal || address.toLowerCase() !== principal.address.toLowerCase()) {
      setNotice({
        type: 'error',
        message: 'Connect and sign in with the same wallet before synchronizing goal managers.',
      });
      return false;
    }

    try {
      setTransactionPending(true);
      setProofHash('');
      if (chainId !== activeChain.id) await switchChainAsync({ chainId: activeChain.id });

      if (request.mode === 'DIRECT') {
        if (!principal.chainAuthorities.includes('OWNER')) {
          throw new Error('Only the confirmed contract owner can send these transactions.');
        }
        if (!publicClient) throw new Error(`${activeDeployment.networkName} RPC is unavailable.`);
        for (const [index, transaction] of request.transactions.entries()) {
          requireMatchingTransactionDeployment(transaction, activeDeployment);
          if (transaction.operation !== OperationType.Call) {
            throw new Error('A direct goal manager transaction has an invalid operation.');
          }
          const hash = await sendTransactionAsync({
            to: getAddress(transaction.to),
            value: BigInt(transaction.value),
            data: transaction.data,
            chainId: activeChain.id,
          });
          setProofHash(hash);
          setNotice({
            type: 'info',
            message: `Goal manager change ${index + 1} of ${request.transactions.length} submitted.`,
          });
          requireSuccessfulReceipt(
            await publicClient.waitForTransactionReceipt({ hash }),
            'Goal manager update',
          );
        }
        setNotice({
          type: 'success',
          message: 'Goal manager changes are confirmed. Waiting for indexer confirmation.',
        });
        await load();
        return true;
      }

      if (!connector || !goalManagers?.actorIsSafeOwner) {
        throw new Error('Connect a confirmed owner wallet of the configured Safe.');
      }
      for (const transaction of request.transactions) {
        requireMatchingTransactionDeployment(transaction, activeDeployment);
      }
      const provider = (await connector.getProvider()) as Eip1193Provider | undefined;
      if (!provider) throw new Error('The connected wallet provider is unavailable.');
      const protocolKit = await Safe.init({
        provider,
        signer: address,
        safeAddress: request.safeAddress,
      });
      const safeTransaction = await protocolKit.createTransaction({
        transactions: request.transactions.map((transaction) => ({
          to: transaction.to,
          value: transaction.value,
          data: transaction.data,
          operation: transaction.operation,
        })),
        options: { nonce: request.safeNonce },
      });
      const safeTxHash = (await protocolKit.getTransactionHash(safeTransaction)) as Hex;
      const signature = await protocolKit.signHash(safeTxHash);
      const proposal = await clientApiJson<AdminSafeGoalManagerProposal>(
        `/v1/admin/goal-manager-intents/${request.intentId}/submit`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            transaction: safeTransaction.data,
            safeTxHash,
            senderAddress: address,
            senderSignature: signature.data as Hex,
          } satisfies AdminSafeProposalSubmission),
        },
        'Safe goal manager submission',
      );
      setNotice({
        type: 'success',
        message:
          proposal.threshold > 1
            ? `Sent to Safe. ${proposal.confirmations} of ${proposal.threshold} approvals collected.`
            : 'Sent to Safe. It is ready to execute in Safe Wallet.',
      });
      await load();
      return true;
    } catch (error) {
      setNotice({
        type: 'error',
        message:
          error instanceof Error
            ? error.message.split('\n')[0]!
            : 'Could not synchronize goal managers.',
      });
      await load().catch(() => undefined);
      return false;
    } finally {
      setTransactionPending(false);
    }
  }

  async function syncGoalManagers() {
    setTransactionPending(true);
    try {
      const request = await clientApiJson<AdminGoalManagerChangeRequest>(
        '/v1/admin/goal-managers/safe-sync/prepare',
        { method: 'POST' },
        'Goal manager synchronization',
      );
      await processGoalManagerRequest(request);
    } catch (error) {
      setNotice({
        type: 'error',
        message: error instanceof Error ? error.message : 'Could not prepare manager sync.',
      });
    } finally {
      setTransactionPending(false);
    }
  }

  async function refreshData() {
    if (!principal || !hasAdminWorkspaceRole(principal)) {
      await load();
      return;
    }

    setState('loading');
    try {
      await clientApiRequest(
        '/v1/admin/goal-managers/refresh',
        { method: 'POST' },
        'Goal manager data refresh',
      );
      await load();
      setNotice({ type: 'success', message: 'Admin data refreshed.' });
    } catch (error) {
      await load().catch(() => undefined);
      setNotice({
        type: 'error',
        message: error instanceof Error ? error.message : 'Could not refresh the admin data.',
      });
    }
  }

  async function updateGoalManager(managerAddress: string, enabled: boolean) {
    setTransactionPending(true);
    try {
      const request = await clientApiJson<AdminGoalManagerChangeRequest>(
        `/v1/admin/goal-managers/${encodeURIComponent(managerAddress)}`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ enabled }),
        },
        enabled ? 'Goal manager pin' : 'Goal manager removal',
      );
      return await processGoalManagerRequest(
        request,
        'Goal manager policy updated. No on-chain change is currently required.',
      );
    } catch (error) {
      setNotice({
        type: 'error',
        message: error instanceof Error ? error.message : 'Could not update the goal manager.',
      });
      return false;
    } finally {
      setTransactionPending(false);
    }
  }

  async function createGoal(input: AdminGoalDraftInput) {
    try {
      await clientApiRequest(
        '/v1/admin/expenses',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input),
        },
        'Goal draft',
      );
      setNotice({
        type: 'success',
        message:
          'Goal draft saved. It is ready to publish; optional IPFS metadata can be added first.',
      });
      await load();
      return true;
    } catch (error) {
      setNotice({
        type: 'error',
        message: error instanceof Error ? error.message : 'Could not save the goal draft.',
      });
      return false;
    }
  }

  async function requestAndExecute(
    url: string,
    init: RequestInit,
    label: string,
    allowedAuthorities: ChainAuthority[],
    onConfirmed?: (hash: Hex) => Promise<void>,
  ) {
    try {
      if (!safeStatus) throw new Error('The API deployment status is unavailable. Refresh first.');
      requireMatchingDeployment(safeStatus, activeDeployment);
      const body = await clientApiJson<{ transactionRequest: AdminTransactionRequest }>(
        url,
        init,
        `${label} preparation`,
      );
      await execute(body.transactionRequest, label, allowedAuthorities, onConfirmed);
    } catch (error) {
      setNotice({
        type: 'error',
        message:
          error instanceof Error ? error.message : `Could not prepare ${label.toLowerCase()}.`,
      });
    }
  }

  function publish(id: string) {
    return requestAndExecute(
      `/v1/admin/expenses/${id}/publish`,
      { method: 'POST' },
      'Goal creation',
      ['OWNER', 'GOAL_MANAGER'],
      async (hash) => {
        try {
          await clientApiRequest(
            `/v1/admin/expenses/${id}/submitted`,
            {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ txHash: hash }),
            },
            'Pending goal update',
          );
        } catch {
          throw new Error(
            'Goal creation succeeded, but the API could not record its pending state. The indexer will still confirm it.',
          );
        }
      },
    );
  }

  async function updateDraft(id: string, input: AdminGoalDraftUpdateInput) {
    try {
      await clientApiRequest(
        `/v1/admin/expenses/${id}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input),
        },
        'Goal draft update',
      );
      setNotice({ type: 'success', message: 'Goal draft changes saved.' });
      await load();
      return true;
    } catch (error) {
      setNotice({
        type: 'error',
        message: error instanceof Error ? error.message : 'The goal draft could not be saved.',
      });
      return false;
    }
  }

  function closeGoal(id: string) {
    return requestAndExecute(
      `/v1/admin/goals/${id}/close-proposal`,
      { method: 'POST' },
      'Goal closure',
      ['OWNER', 'GOAL_MANAGER'],
    );
  }

  function cancelGoal(id: string) {
    return requestAndExecute(
      `/v1/admin/goals/${id}/cancel-proposal`,
      { method: 'POST' },
      'Goal cancellation',
      ['OWNER', 'GOAL_MANAGER'],
    );
  }

  async function release(
    goalId: string,
    asset: 'PRE' | 'USDC',
    kind: 'EXPENSE' | 'CANCELLED_FUNDS',
    amountRaw: bigint,
  ) {
    if (!address || !connector || !principal) {
      setNotice({ type: 'error', message: 'Connect and sign in with a Safe owner wallet first.' });
      return;
    }
    if (address.toLowerCase() !== principal.address.toLowerCase()) {
      setNotice({
        type: 'error',
        message: 'Connect and sign in with the same Safe owner wallet before signing.',
      });
      return;
    }
    if (!principal.safeOwner || !safeStatus?.safeOwner) {
      setNotice({ type: 'error', message: 'The connected wallet is not an owner of this Safe.' });
      return;
    }
    if (!safeStatus?.isEscrowOwner || !safeStatus.serviceConfigured) {
      setNotice({ type: 'error', message: 'Safe payout approvals are not ready yet.' });
      return;
    }

    try {
      requireMatchingDeployment(safeStatus, activeDeployment);
      setTransactionPending(true);
      setProofHash('');
      if (chainId !== activeChain.id) await switchChainAsync({ chainId: activeChain.id });
      const intent = await clientApiJson<AdminSafePayoutIntent>(
        `/v1/admin/goals/${goalId}/safe-payout-intents`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ asset, kind, amountRaw: amountRaw.toString() }),
        },
        'Safe payout preparation',
      );
      requireMatchingTransactionDeployment(intent.transactionRequest, activeDeployment);
      const provider = (await connector.getProvider()) as Eip1193Provider | undefined;
      if (!provider) throw new Error('The connected wallet provider is unavailable.');
      const protocolKit = await Safe.init({
        provider,
        signer: address,
        safeAddress: intent.safeAddress,
      });
      const safeTransaction = await protocolKit.createTransaction({
        transactions: [
          {
            to: intent.transactionRequest.to,
            value: intent.transactionRequest.value,
            data: intent.transactionRequest.data,
            operation: OperationType.Call,
          },
        ],
        options: { nonce: intent.safeNonce },
      });
      const safeTxHash = (await protocolKit.getTransactionHash(safeTransaction)) as Hex;
      const signature = await protocolKit.signHash(safeTxHash);
      const submission: AdminSafeProposalSubmission = {
        transaction: safeTransaction.data,
        safeTxHash,
        senderAddress: address,
        senderSignature: signature.data as Hex,
      };
      const proposal = await clientApiJson<AdminSafePayoutProposal>(
        `/v1/admin/safe-payout-intents/${intent.id}/submit`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(submission),
        },
        'Safe payout submission',
      );
      setNotice({
        type: 'success',
        message:
          proposal.threshold > 1
            ? `Sent to Safe. ${proposal.confirmations} of ${proposal.threshold} approvals collected.`
            : 'Sent to Safe. It is ready to execute in Safe Wallet.',
      });
      await load();
    } catch (error) {
      setNotice({
        type: 'error',
        message: error instanceof Error ? error.message.split('\n')[0]! : 'Could not send to Safe.',
      });
      await load().catch(() => undefined);
    } finally {
      setTransactionPending(false);
    }
  }

  async function goalLifecycle(
    goalId: string,
    kind: AdminGoalLifecycleKind,
    monthlySurplusPolicy?: 'PAYOUT_ALL' | 'ROLL_OVER',
  ) {
    if (!address || !principal) {
      setNotice({ type: 'error', message: 'Connect and sign in with an authorized wallet first.' });
      return;
    }
    if (address.toLowerCase() !== principal.address.toLowerCase()) {
      setNotice({ type: 'error', message: 'Connect and sign in with the same wallet.' });
      return;
    }
    try {
      const preparation = await clientApiJson<AdminGoalLifecyclePreparation>(
        `/v1/admin/goals/${goalId}/lifecycle-intents`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ kind, monthlySurplusPolicy }),
        },
        'Monthly lifecycle preparation',
      );
      if (preparation.mode === 'DIRECT') {
        await execute(
          preparation.transactionRequest,
          kind === 'SET_MONTHLY_SURPLUS_POLICY' ? 'Monthly policy change' : 'Monthly graceful stop',
          ['OWNER', 'GOAL_MANAGER'],
        );
        return;
      }

      if (!connector || !principal.safeOwner || !safeStatus?.safeOwner) {
        throw new Error('Use the signed-in owner wallet of this Safe.');
      }
      if (!safeStatus.isEscrowOwner || !safeStatus.serviceConfigured) {
        throw new Error('Safe lifecycle approvals are not ready yet.');
      }
      requireMatchingDeployment(safeStatus, activeDeployment);
      setTransactionPending(true);
      setProofHash('');
      if (chainId !== activeChain.id) await switchChainAsync({ chainId: activeChain.id });
      const intent = preparation;
      requireMatchingTransactionDeployment(intent.transactionRequest, activeDeployment);
      const provider = (await connector.getProvider()) as Eip1193Provider | undefined;
      if (!provider) throw new Error('The connected wallet provider is unavailable.');
      const protocolKit = await Safe.init({
        provider,
        signer: address,
        safeAddress: intent.safeAddress,
      });
      const safeTransaction = await protocolKit.createTransaction({
        transactions: [
          {
            to: intent.transactionRequest.to,
            value: intent.transactionRequest.value,
            data: intent.transactionRequest.data,
            operation: OperationType.Call,
          },
        ],
        options: { nonce: intent.safeNonce },
      });
      const safeTxHash = (await protocolKit.getTransactionHash(safeTransaction)) as Hex;
      const signature = await protocolKit.signHash(safeTxHash);
      const proposal = await clientApiJson<AdminSafeGoalActionProposal>(
        `/v1/admin/safe-goal-action-intents/${intent.id}/submit`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            transaction: safeTransaction.data,
            safeTxHash,
            senderAddress: address,
            senderSignature: signature.data as Hex,
          } satisfies AdminSafeProposalSubmission),
        },
        'Safe lifecycle submission',
      );
      setNotice({
        type: 'success',
        message:
          proposal.threshold > 1
            ? `Sent to Safe. ${proposal.confirmations} of ${proposal.threshold} approvals collected.`
            : 'Sent to Safe. It is ready to execute in Safe Wallet.',
      });
      await load();
    } catch (error) {
      setNotice({
        type: 'error',
        message: error instanceof Error ? error.message.split('\n')[0]! : 'Could not send to Safe.',
      });
      await load().catch(() => undefined);
    } finally {
      setTransactionPending(false);
    }
  }

  async function proposeOwnershipAcceptance() {
    if (!address || !connector || !principal) {
      setNotice({ type: 'error', message: 'Connect and sign in with a Safe owner wallet first.' });
      return;
    }
    if (address.toLowerCase() !== principal.address.toLowerCase()) {
      setNotice({
        type: 'error',
        message: 'Connect and sign in with the same Safe owner wallet before signing.',
      });
      return;
    }
    if (!safeStatus?.isPendingEscrowOwner) {
      setNotice({ type: 'error', message: 'This Safe is not the pending escrow owner.' });
      return;
    }
    if (!safeStatus.safeOwner) {
      setNotice({ type: 'error', message: 'The connected wallet is not an owner of this Safe.' });
      return;
    }
    if (!safeStatus.serviceConfigured) {
      setNotice({ type: 'error', message: 'Safe Transaction Service is unavailable.' });
      return;
    }

    try {
      requireMatchingDeployment(safeStatus, activeDeployment);
      setTransactionPending(true);
      setProofHash('');
      if (chainId !== activeChain.id) await switchChainAsync({ chainId: activeChain.id });
      const request = await clientApiJson<AdminSafeOwnershipAcceptanceRequest>(
        '/v1/admin/safe/ownership-acceptance',
        { method: 'POST' },
        'Safe ownership acceptance preparation',
      );
      requireMatchingTransactionDeployment(request.transactionRequest, activeDeployment);
      if (request.existingProposal) {
        setSafeStatus((current) =>
          current ? { ...current, ownershipAcceptance: request.existingProposal } : current,
        );
        setNotice({
          type: 'info',
          message: 'Ownership acceptance is already waiting in Safe.',
        });
        return;
      }

      const provider = (await connector.getProvider()) as Eip1193Provider | undefined;
      if (!provider) throw new Error('The connected wallet provider is unavailable.');
      const protocolKit = await Safe.init({
        provider,
        signer: address,
        safeAddress: request.safeAddress,
      });
      const safeTransaction = await protocolKit.createTransaction({
        transactions: [
          {
            to: request.transactionRequest.to,
            value: request.transactionRequest.value,
            data: request.transactionRequest.data,
            operation: OperationType.Call,
          },
        ],
        options: { nonce: request.safeNonce },
      });
      const safeTxHash = (await protocolKit.getTransactionHash(safeTransaction)) as Hex;
      const signature = await protocolKit.signHash(safeTxHash);
      const submission: AdminSafeProposalSubmission = {
        transaction: safeTransaction.data,
        safeTxHash,
        senderAddress: address,
        senderSignature: signature.data as Hex,
      };
      const proposal = await clientApiJson<AdminSafeOwnershipAcceptance>(
        '/v1/admin/safe/ownership-acceptance/submit',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(submission),
        },
        'Safe ownership acceptance submission',
      );
      setNotice({
        type: 'success',
        message: proposal.readyToExecute
          ? 'Ownership acceptance is ready to execute in Safe Wallet.'
          : `Sent to Safe. ${proposal.confirmations} of ${proposal.threshold} approvals collected.`,
      });
      await load();
      setSafeStatus((current) =>
        current?.isPendingEscrowOwner ? { ...current, ownershipAcceptance: proposal } : current,
      );
    } catch (error) {
      setNotice({
        type: 'error',
        message:
          error instanceof Error
            ? error.message.split('\n')[0]!
            : 'Could not send ownership acceptance to Safe.',
      });
      await load().catch(() => undefined);
    } finally {
      setTransactionPending(false);
    }
  }

  function transferOwnershipToSafe() {
    return requestAndExecute(
      '/v1/admin/safe/ownership-transfer',
      { method: 'POST' },
      'Safe ownership transfer',
      ['OWNER'],
    );
  }

  return {
    cancelGoal,
    closeGoal,
    createGoal,
    createSubproject,
    goalManagers,
    goalLifecycle,
    load,
    notice,
    principal,
    proofHash,
    proposeOwnershipAcceptance,
    publish,
    refreshData,
    release,
    safeProposals,
    safeGoalActions,
    safeStatus,
    state,
    transactionExplorerUrl: proofHash ? activeExplorerTransaction(proofHash) : null,
    transactionPending,
    transferOwnershipToSafe,
    syncGoalManagers,
    updateGoalManager,
    updateDraft,
    workspace,
  };
}
