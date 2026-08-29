import { ArrowUpRight, Download } from 'lucide-react';
import { ActivityLedger } from '@/components/activity-ledger';
import { FundingMeter } from '@/components/funding-meter';
import { GoalList } from '@/components/goal-list';
import { getDashboardAvailability } from '@/lib/api';
import { activeDeployment } from '@/lib/deployment';

export const metadata = {
  title: 'Funding',
  description: 'Verified Presearch community goals, balances and confirmed funding activity.',
};

export default async function FundingPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const query = await searchParams;
  const dashboardAvailability = await getDashboardAvailability(query.month);
  const dashboard = dashboardAvailability.dashboard;

  if (!dashboard) {
    return (
      <main className="page-gutter pt-7 pb-[60px]" data-testid="funding-page">
        <section
          className="my-7 flex min-h-[220px] flex-col items-center justify-center border-y border-line px-[18px] py-8 text-center"
          role="status"
        >
          <span className="font-mono text-[11px] tracking-[.05em] text-blue uppercase">
            Indexer catching up
          </span>
          <h1 className="mt-2.5 mb-1 text-2xl">Verified funding data is temporarily unavailable</h1>
          <p className="max-w-xl text-muted">
            Fresh chain proof is being rebuilt. This page will become available automatically when
            the indexer catches up.
          </p>
          <a
            className="mt-3 inline-flex items-center gap-1.5 text-xs text-blue"
            href={activeDeployment.explorerUrl}
            target="_blank"
            rel="noreferrer"
          >
            Open {activeDeployment.networkName} explorer <ArrowUpRight size={15} />
          </a>
        </section>
      </main>
    );
  }

  return (
    <main data-testid="funding-page">
      <section className="page-gutter py-9 max-sm:py-7" id="goals">
        <header className="mb-5">
          <h1 className="mt-0 text-2xl leading-[1.15] tracking-[-.025em]">Goals</h1>
        </header>
        <GoalList goals={dashboard.goals} month={dashboard.month} />
      </section>

      <section className="page-gutter bg-blue-soft py-9 max-sm:py-7" id="activity">
        <header className="mb-5">
          <h2 className="mt-0 text-2xl leading-[1.15] tracking-[-.025em]">Activity</h2>
        </header>
        <ActivityLedger activity={dashboard.activity} />
        <a
          className="mt-4 inline-flex items-center gap-1.5 text-xs text-blue"
          href={activeDeployment.explorerUrl}
          target="_blank"
          rel="noreferrer"
        >
          Open {activeDeployment.networkName} explorer <ArrowUpRight size={15} />
        </a>
      </section>

      <section className="funding-summary-grid page-gutter border-y border-line bg-white py-9 max-sm:py-7">
        <div>
          <h2 className="mt-0 text-2xl leading-[1.15] tracking-[-.025em]">Funding summary</h2>
          <a
            className="mt-3.5 inline-flex min-h-9 items-center justify-center gap-1.5 rounded border border-navy bg-white px-3 font-bold hover:bg-blue-soft"
            href={`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}/v1/public/reports?month=${dashboard.month}&format=csv`}
          >
            <Download size={16} /> Export chain report
          </a>
        </div>
        <div className="flex flex-col justify-center gap-[22px]">
          {dashboard.totals.length ? (
            dashboard.totals.map((item) => <FundingMeter item={item} key={item.asset} />)
          ) : (
            <div>
              <p className="text-muted">No funding data yet.</p>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
