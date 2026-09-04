'use client';

import { useState } from 'react';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import type {
  FundingGoalPeriodsPage,
  GoalSummary,
  MonthlySettlementRequest,
} from '@precommunity/shared';
import { ArrowUpRight, LoaderCircle } from 'lucide-react';
import { getAddress } from 'viem';
import { useAccount, usePublicClient, useSendTransaction, useSwitchChain } from 'wagmi';
import { useRouter } from 'next/navigation';
import { activeChain, activeDeployment, activeExplorerTransaction } from '@/lib/deployment';
import { clientApiJson } from '@/lib/http';
import { requireMatchingTransactionDeployment, requireSuccessfulReceipt } from '@/lib/transactions';
import { ActionButton } from './action-button';

export function MonthlyGoalPanel({
  goal,
  periods: initialPeriods,
}: {
  goal: GoalSummary;
  periods: FundingGoalPeriodsPage;
}) {
  const monthly = goal.monthly!;
  const settlementAvailable = monthly.phase === 'SETTLEMENT_DUE';
  const { address, chainId, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { switchChainAsync } = useSwitchChain();
  const { sendTransactionAsync } = useSendTransaction();
  const publicClient = usePublicClient({ chainId: activeChain.id });
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'preparing' | 'confirming' | 'confirmed' | 'error'>(
    'idle',
  );
  const [message, setMessage] = useState('');
  const [hash, setHash] = useState<`0x${string}` | null>(null);
  const [periods, setPeriods] = useState(initialPeriods);
  const [historyState, setHistoryState] = useState<'idle' | 'loading' | 'error'>('idle');
  const showSettlementPanel = settlementAvailable || Boolean(message);

  async function loadMorePeriods() {
    if (!periods.nextCursor || historyState === 'loading') return;
    try {
      setHistoryState('loading');
      const next = await clientApiJson<FundingGoalPeriodsPage>(
        `/v1/public/goals/${encodeURIComponent(goal.slug)}/periods?cursor=${encodeURIComponent(periods.nextCursor)}&limit=12`,
        undefined,
        'Monthly period history',
      );
      setPeriods((current) => ({
        items: [...current.items, ...next.items],
        nextCursor: next.nextCursor,
      }));
      setHistoryState('idle');
    } catch {
      setHistoryState('error');
    }
  }

  async function settle() {
    if (!isConnected || !address) {
      openConnectModal?.();
      return;
    }
    try {
      setState('preparing');
      setMessage('Preparing permissionless settlement calldata…');
      const request = await clientApiJson<MonthlySettlementRequest>(
        `/v1/public/goals/${encodeURIComponent(goal.slug)}/settlement-request`,
        { method: 'POST' },
        'Monthly settlement request',
      );
      requireMatchingTransactionDeployment(request.transactionRequest, activeDeployment);
      if (!publicClient) throw new Error(`${activeDeployment.networkName} RPC is unavailable.`);
      if (chainId !== activeChain.id) await switchChainAsync({ chainId: activeChain.id });
      const txHash = await sendTransactionAsync({
        to: getAddress(request.transactionRequest.to),
        value: BigInt(request.transactionRequest.value),
        data: request.transactionRequest.data,
        chainId: activeChain.id,
      });
      setHash(txHash);
      setState('confirming');
      setMessage(`Settling ${request.maxPeriods} of ${request.periodsDue} due period(s)…`);
      requireSuccessfulReceipt(
        await publicClient.waitForTransactionReceipt({
          hash: txHash,
          confirmations: activeDeployment.confirmations,
        }),
        'Monthly settlement',
      );
      setState('confirmed');
      setMessage(
        request.remainingAfterThisTransaction > 0
          ? `${request.remainingAfterThisTransaction} period(s) remain. Wait for indexing, then submit the next settlement.`
          : 'Settlement confirmed. The updated period will appear after indexing.',
      );
      router.refresh();
    } catch (error) {
      setState('error');
      setMessage(error instanceof Error ? error.message.split('\n')[0]! : 'Settlement failed.');
    }
  }

  return (
    <section className="border-y border-line py-7" aria-labelledby="monthly-ledger-title">
      <div
        className={`grid gap-8 ${
          showSettlementPanel
            ? 'grid-cols-[minmax(0,1fr)_280px] max-[800px]:grid-cols-1'
            : 'grid-cols-1'
        }`}
      >
        <div>
          <span className="font-mono text-[11px] tracking-[.05em] text-blue uppercase">
            Monthly lifecycle · {monthly.phase.replaceAll('_', ' ')}
          </span>
          <h2 className="mt-1.5 text-2xl" id="monthly-ledger-title">
            Period #{monthly.selectedPeriod.periodIndex}
          </h2>
          <p className="text-sm text-muted">
            {new Date(monthly.selectedPeriod.startsAt).toLocaleDateString('en-GB', {
              timeZone: 'UTC',
            })}{' '}
            –{' '}
            {new Date(monthly.selectedPeriod.endsAt).toLocaleDateString('en-GB', {
              timeZone: 'UTC',
            })}{' '}
            UTC · {monthly.surplusPolicy.replaceAll('_', ' ')}
          </p>
          <p className="mt-2 max-w-[68ch] text-xs leading-5 text-muted">
            First settlement: {monthly.firstSettlementAt.slice(0, 10)} at 00:00 UTC · base day{' '}
            {monthly.settlementDay}. Contributions are available as soon as the goal is indexed.
            {monthly.settlementDay >= 29
              ? ' Shorter months use their final day, then the schedule returns to the base day.'
              : ''}
          </p>
          <div className="mt-5 border-t border-line">
            {monthly.selectedPeriod.assets.map((asset) => (
              <div
                className="grid grid-cols-5 gap-3 border-b border-line py-3 text-xs max-sm:grid-cols-2"
                key={asset.asset}
              >
                <strong>{asset.asset}</strong>
                <span>
                  <small className="block text-muted">Contributed</small>
                  {asset.contributed}
                </span>
                <span>
                  <small className="block text-muted">Carry in</small>
                  {asset.carryIn}
                </span>
                <span>
                  <small className="block text-muted">Vested</small>
                  {asset.vested}
                </span>
                <span>
                  <small className="block text-muted">Carry out</small>
                  {asset.carryOut}
                </span>
              </div>
            ))}
          </div>
        </div>
        {showSettlementPanel ? (
          <aside className="border-l border-line pl-6 max-[800px]:border-t max-[800px]:border-l-0 max-[800px]:pt-5 max-[800px]:pl-0">
            <small className="font-mono text-[10px] text-muted uppercase">Public settlement</small>
            <p className="text-xs text-muted">
              Any wallet may settle elapsed periods. Settlement updates accounting only and
              transfers no funds.
            </p>
            {settlementAvailable ? (
              <ActionButton
                variant="primary"
                disabled={state === 'preparing' || state === 'confirming'}
                onClick={() => void settle()}
                icon={
                  state === 'preparing' || state === 'confirming' ? (
                    <LoaderCircle className="animate-spin" size={15} />
                  ) : undefined
                }
              >
                Settle due periods
              </ActionButton>
            ) : null}
            {message ? (
              <p
                className={`mt-3 text-xs ${state === 'error' ? 'text-danger' : 'text-muted'}`}
                role="status"
              >
                {message}
                {hash ? (
                  <a
                    className="ml-1 inline-flex items-center gap-1 text-blue"
                    href={activeExplorerTransaction(hash)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Proof <ArrowUpRight size={12} />
                  </a>
                ) : null}
              </p>
            ) : null}
          </aside>
        ) : null}
      </div>

      <div className="mt-8">
        <h3 className="mb-2 text-lg">Lifetime accounting</h3>
        <div className="overflow-x-auto border-t border-navy">
          <table className="w-full min-w-[760px] border-collapse text-left text-xs">
            <thead className="font-mono text-[10px] text-muted uppercase">
              <tr>
                <th className="border-b border-line py-2">Asset</th>
                <th className="border-b border-line py-2">Contributions</th>
                <th className="border-b border-line py-2">Beneficiary entitlement</th>
                <th className="border-b border-line py-2">Paid</th>
                <th className="border-b border-line py-2">Available</th>
                <th className="border-b border-line py-2">Treasury entitlement</th>
                <th className="border-b border-line py-2">Treasury available</th>
              </tr>
            </thead>
            <tbody>
              {monthly.lifetime.map((asset) => (
                <tr key={asset.asset}>
                  <td className="border-b border-line py-2.5 font-bold">{asset.asset}</td>
                  <td className="border-b border-line py-2.5">{asset.contributions}</td>
                  <td className="border-b border-line py-2.5">{asset.beneficiaryEntitlement}</td>
                  <td className="border-b border-line py-2.5">{asset.beneficiaryPayouts}</td>
                  <td className="border-b border-line py-2.5 text-blue">
                    {asset.beneficiaryAvailable}
                  </td>
                  <td className="border-b border-line py-2.5">{asset.treasuryEntitlement}</td>
                  <td className="border-b border-line py-2.5">{asset.treasuryAvailable}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-8">
        <h3 className="mb-2 text-lg">Period history</h3>
        <div className="overflow-x-auto border-t border-navy">
          <table className="w-full min-w-[680px] border-collapse text-left text-xs">
            <thead className="font-mono text-[10px] text-muted uppercase">
              <tr>
                <th className="border-b border-line py-2">Period</th>
                <th className="border-b border-line py-2">UTC range</th>
                <th className="border-b border-line py-2">Policy</th>
                <th className="border-b border-line py-2">Status</th>
                <th className="border-b border-line py-2">Proof</th>
              </tr>
            </thead>
            <tbody>
              {periods.items.map((period) => (
                <tr
                  className="motion-safe:animate-[row-rise_.3s_ease-out]"
                  key={period.periodIndex}
                >
                  <td className="border-b border-line py-2.5">#{period.periodIndex}</td>
                  <td className="border-b border-line py-2.5">
                    {period.startsAt.slice(0, 10)} → {period.endsAt.slice(0, 10)}
                  </td>
                  <td className="border-b border-line py-2.5">
                    {period.surplusPolicy.replaceAll('_', ' ')}
                  </td>
                  <td className="border-b border-line py-2.5">
                    {period.settledAt ? 'SETTLED' : 'OPEN'}
                  </td>
                  <td className="border-b border-line py-2.5 font-mono">
                    {period.settlementTxHash ? (
                      <a
                        className="text-blue"
                        href={activeExplorerTransaction(period.settlementTxHash)}
                        target="_blank"
                        rel="noreferrer"
                        title={`${period.settlementBlockHash ?? ''}:${period.settlementLogIndex ?? ''}`}
                      >
                        {period.settlementBlock ?? 'View'}
                      </a>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {periods.nextCursor ? (
          <ActionButton
            className="mt-3"
            size="compact"
            disabled={historyState === 'loading'}
            icon={
              historyState === 'loading' ? (
                <LoaderCircle className="animate-spin" size={14} />
              ) : undefined
            }
            onClick={() => void loadMorePeriods()}
          >
            Load earlier periods
          </ActionButton>
        ) : null}
        {historyState === 'error' ? (
          <p className="mt-2 text-xs text-danger" role="status">
            Earlier periods could not be loaded. Try again.
          </p>
        ) : null}
      </div>
    </section>
  );
}
