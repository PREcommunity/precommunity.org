import { ExternalLink } from 'lucide-react';
import type { AdminSafeGoalActionProposal } from '@/lib/admin-workspace-types';

export function SafeLifecyclePanel({ proposals }: { proposals: AdminSafeGoalActionProposal[] }) {
  if (!proposals.length) return null;

  return (
    <section className="mt-7 border-y border-line py-5" aria-labelledby="safe-lifecycle-title">
      <div className="flex items-end justify-between gap-4">
        <div>
          <span className="font-mono text-[11px] tracking-[.05em] text-blue uppercase">
            Durable Safe workflow
          </span>
          <h2 className="mt-1 mb-0 text-xl" id="safe-lifecycle-title">
            Monthly lifecycle queue
          </h2>
        </div>
        <small className="text-muted">{proposals.length} recorded proposal(s)</small>
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[680px] border-collapse text-left text-xs">
          <thead className="font-mono text-[10px] text-muted uppercase">
            <tr>
              <th className="border-b border-line py-2">Goal</th>
              <th className="border-b border-line py-2">Action</th>
              <th className="border-b border-line py-2">Safe status</th>
              <th className="border-b border-line py-2">Approvals</th>
              <th className="border-b border-line py-2">Proof</th>
            </tr>
          </thead>
          <tbody>
            {proposals.map((proposal) => (
              <tr key={proposal.id}>
                <td className="border-b border-line py-2.5">
                  {proposal.intent?.goal.title ?? 'Monthly goal'}
                </td>
                <td className="border-b border-line py-2.5">
                  {proposal.intent?.kind.replaceAll('_', ' ') ?? 'Lifecycle action'}
                </td>
                <td className="border-b border-line py-2.5">
                  {proposal.status.replaceAll('_', ' ')}
                </td>
                <td className="border-b border-line py-2.5">
                  {proposal.confirmations}/{proposal.threshold}
                </td>
                <td className="border-b border-line py-2.5">
                  {proposal.queueUrl ? (
                    <a
                      className="inline-flex items-center gap-1 text-blue"
                      href={proposal.queueUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Safe queue <ExternalLink size={12} />
                    </a>
                  ) : (
                    <span className="text-muted">Unavailable</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
