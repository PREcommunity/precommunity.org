import { PRE_DECIMALS, type AdKeywordResponse } from '@precommunity/shared';
import { formatUnits } from 'viem';

export function KeywordMarketRanking({ data }: { data: AdKeywordResponse }) {
  return (
    <div className="overflow-x-auto">
      <section
        className="keyword-market-ledger keyword-market-ranking-ledger"
        aria-label={`USD bid ranking for ${data.keyword}`}
      >
        <div className="keyword-market-ledger-head">
          <span>Rank / staker</span>
          <span>Bid per click</span>
          <span>PRE stake</span>
          <span>Proof</span>
          <span>Eligible</span>
        </div>
        {data.positions.map((position, index) => (
          <div
            className="keyword-market-ledger-row"
            key={position.stakerAddress}
            style={{ '--keyword-market-row-index': index } as React.CSSProperties}
          >
            <span className="keyword-market-ledger-keyword">
              <small>{position.eligible ? `#${position.rank}` : '—'}</small>
              <strong title={position.stakerAddress}>
                {position.stakerAddress.slice(0, 8)}…{position.stakerAddress.slice(-6)}
              </strong>
            </span>
            <span>
              <strong>${formatUnits(BigInt(position.bidUsdRaw), 6)}</strong>
              <small>USD / click</small>
            </span>
            <span>
              <strong>{formatUnits(BigInt(position.stakeRaw), PRE_DECIMALS)}</strong>
              <small>PRE</small>
            </span>
            <span>
              <strong>{position.positionBlock}</strong>
              <small title={position.positionTxHash}>{position.positionTxHash.slice(0, 12)}…</small>
            </span>
            <span
              className={`keyword-market-status ${position.eligible && position.hasEligibleAd ? 'keyword-market-status-success' : 'keyword-market-status-muted'}`}
            >
              {!position.eligible
                ? position.withdrawAvailableAt !== '0'
                  ? 'Withdrawing'
                  : 'Needs PRE'
                : position.hasEligibleAd
                  ? 'Eligible'
                  : 'No approved ad'}
            </span>
          </div>
        ))}
      </section>
    </div>
  );
}
