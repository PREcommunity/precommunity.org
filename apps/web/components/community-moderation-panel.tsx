'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ShieldCheck, X } from 'lucide-react';
import type { CommunityProposal } from '@precommunity/shared';
import { clientApiJson, clientApiRequest } from '@/lib/http';
import { normalizeSlugSpaces } from '../lib/slug';
import { ActionButton } from './action-button';
import { FormFieldError, useFormValidation } from './form-validation';
import {
  formLabelClass,
  formLabelTextClass,
  selectClass,
  textInputClass,
  textareaClass,
} from './form-control-classes';
import { StatusNotice, type StatusNoticeState } from './status-notice';
import { MonthlyScheduleFields, utcDateInputToIso } from './monthly-schedule-fields';

function positive(value: string) {
  return /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) && !/^0(?:\.0+)?$/.test(value);
}
type ModerationWorkspace = {
  config: { proposalModerationEnabled: boolean };
  proposals: CommunityProposal[];
};

export function CommunityModerationPanel({
  onDraftCreated,
}: {
  onDraftCreated: () => Promise<void>;
}) {
  const [proposals, setProposals] = useState<CommunityProposal[]>([]);
  const [moderationEnabled, setModerationEnabled] = useState<boolean>();
  const [expanded, setExpanded] = useState<string>();
  const [conversionCadence, setConversionCadence] = useState<'ONE_TIME' | 'MONTHLY'>('ONE_TIME');
  const [notice, setNotice] = useState<StatusNoticeState | null>(null);
  const validation = useFormValidation();

  async function load() {
    try {
      const workspace = await clientApiJson<ModerationWorkspace>(
        '/v1/community/admin/proposals',
        undefined,
        'Proposal moderation workspace',
      );
      setProposals(workspace.proposals);
      setModerationEnabled(workspace.config.proposalModerationEnabled);
    } catch (error) {
      setNotice({
        type: 'error',
        message:
          error instanceof Error
            ? error.message
            : 'Proposal moderation workspace could not be loaded.',
      });
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function toggleModeration() {
    if (moderationEnabled === undefined) return;
    try {
      await clientApiRequest(
        '/v1/community/admin/settings',
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ proposalModerationEnabled: !moderationEnabled }),
        },
        'Proposal review setting',
      );
      setNotice({
        type: 'success',
        message: `Proposal pre-moderation ${moderationEnabled ? 'disabled' : 'enabled'}.`,
      });
      await load();
    } catch (error) {
      setNotice({
        type: 'error',
        message:
          error instanceof Error ? error.message : 'Proposal review setting could not be updated.',
      });
    }
  }

  async function moderate(id: string, action: 'open-voting' | 'decline' | 'remove') {
    try {
      await clientApiRequest(
        `/v1/community/admin/proposals/${id}/${action}`,
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
        'Proposal moderation',
      );
      setNotice({
        type: 'success',
        message:
          action === 'open-voting'
            ? 'Voting opened with a confirmed snapshot.'
            : 'Proposal status updated.',
      });
      await load();
    } catch (error) {
      setNotice({
        type: 'error',
        message: error instanceof Error ? error.message : 'Moderation action failed.',
      });
    }
  }

  async function convert(event: FormEvent<HTMLFormElement>, proposal: CommunityProposal) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const pre = String(form.get('pre') ?? '0');
    const usdc = String(form.get('usdc') ?? '0');
    const cadence = String(form.get('cadence')) as 'ONE_TIME' | 'MONTHLY';
    const deadline = cadence === 'ONE_TIME' ? new Date(String(form.get('deadline') ?? '')) : null;
    const firstSettlementAt = utcDateInputToIso(String(form.get('firstSettlementAt') ?? ''));
    const payload = {
      name: String(form.get('name')),
      slug: normalizeSlugSpaces(String(form.get('slug'))),
      description: proposal.description,
      purpose: String(form.get('purpose')),
      category: proposal.category,
      cadence,
      recipientAddress: form.get('recipientAddress'),
      ...(deadline
        ? { deadline: deadline.toISOString() }
        : {
            monthlySurplusPolicy: String(form.get('monthlySurplusPolicy')),
            ...(firstSettlementAt ? { firstSettlementAt } : {}),
          }),
      discussionUrl: `${window.location.origin}/community/${proposal.slug}`,
      targets: [
        { asset: 'PRE', amount: pre },
        { asset: 'USDC', amount: usdc },
      ].filter((target) => positive(target.amount)),
    };
    try {
      await clientApiRequest(
        `/v1/admin/community-proposals/${proposal.id}/convert`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        },
        'Draft conversion',
      );
      setNotice({
        type: 'success',
        message: 'Community proposal copied into an unpublished goal draft.',
      });
      setExpanded(undefined);
      await Promise.all([load(), onDraftCreated()]);
    } catch (error) {
      setNotice({
        type: 'error',
        message: error instanceof Error ? error.message : 'Draft conversion failed.',
      });
    }
  }

  const active = proposals.filter((proposal) => proposal.status !== 'REMOVED');
  return (
    <section className="mt-7 pt-6">
      <header className="flex items-end justify-between gap-3 border-b border-navy pb-2 max-sm:flex-col max-sm:items-stretch">
        <div>
          <span className="font-mono text-[11px] tracking-[.05em] text-blue uppercase">
            Community pipeline
          </span>
          <h2 className="m-0 text-xl">Review and promote ideas</h2>
        </div>
        <span className="flex items-center gap-2 max-sm:justify-between">
          <small className="text-[10px] text-muted">
            {active.filter((proposal) => proposal.status === 'PENDING_REVIEW').length} awaiting
            review
          </small>
          <button
            className={`flex min-h-8 cursor-pointer items-center gap-2 rounded-md border border-navy px-2.5 text-[10px] font-bold transition-colors duration-150 hover:border-blue hover:bg-blue-soft ${moderationEnabled ? 'bg-navy text-white hover:text-navy dark:hover:text-white' : 'bg-white'}`}
            role="switch"
            aria-checked={moderationEnabled ?? false}
            disabled={moderationEnabled === undefined}
            onClick={() => void toggleModeration()}
          >
            <i className={`size-2 rounded-full ${moderationEnabled ? 'bg-success' : 'bg-muted'}`} />
            <span>{moderationEnabled ? 'Proposal review on' : 'Proposal review off'}</span>
          </button>
        </span>
      </header>
      <StatusNotice notice={notice} />
      <div className="mt-3">
        {active.length ? (
          active.map((proposal) => (
            <article key={proposal.id}>
              <div className="group grid min-h-[58px] grid-cols-[90px_minmax(180px,1fr)_auto] items-center gap-3 border-b border-line max-[900px]:grid-cols-[90px_1fr_auto] max-sm:grid-cols-1 max-sm:py-2.5">
                <span className="font-mono text-[8px] uppercase transition-transform duration-180 group-hover:translate-x-1">
                  {proposal.status.replaceAll('_', ' ')}
                </span>
                <Link
                  className="-mx-2 -my-1 flex flex-col rounded-md px-2 py-1 transition-transform duration-180 group-hover:translate-x-1"
                  href={`/community/proposals/${proposal.slug}`}
                >
                  <strong>{proposal.title}</strong>
                  <small className="text-muted">
                    {proposal.category} · {proposal.results.voterCount} voters
                  </small>
                </Link>
                <span className="flex gap-[7px] max-[900px]:col-span-2 max-sm:col-auto max-sm:flex-wrap">
                  {proposal.status === 'PENDING_REVIEW' ? (
                    <>
                      <ActionButton
                        size="compact"
                        icon={<ShieldCheck size={13} />}
                        onClick={() => void moderate(proposal.id, 'open-voting')}
                      >
                        Open vote
                      </ActionButton>
                      <ActionButton
                        size="compact"
                        icon={<X size={13} />}
                        onClick={() => void moderate(proposal.id, 'decline')}
                      >
                        Decline
                      </ActionButton>
                    </>
                  ) : null}
                  {proposal.status === 'PASSED' ? (
                    <ActionButton
                      size="compact"
                      icon={<ChevronDown size={13} />}
                      onClick={() =>
                        setExpanded((current) => {
                          setConversionCadence('ONE_TIME');
                          return current === proposal.id ? undefined : proposal.id;
                        })
                      }
                    >
                      Create goal draft
                    </ActionButton>
                  ) : null}
                  {proposal.status !== 'CONVERTED' ? (
                    <ActionButton
                      variant="danger"
                      size="compact"
                      onClick={() => void moderate(proposal.id, 'remove')}
                    >
                      Remove
                    </ActionButton>
                  ) : null}
                </span>
              </div>
              {expanded === proposal.id ? (
                <form
                  className="grid grid-cols-2 gap-3.5 bg-blue-soft p-4 max-sm:grid-cols-1"
                  onSubmit={(event) => void convert(event, proposal)}
                  onInvalid={validation.onInvalid}
                  onInput={validation.onInput}
                >
                  <div className="col-span-full">
                    <span className="font-mono text-[11px] tracking-[.05em] text-blue uppercase">
                      Passed proposal
                    </span>
                    <h3 className="my-1 text-xl">Complete the funding record</h3>
                    <p className="text-muted">
                      Community text is copied into the internal draft. These fields define the
                      later on-chain goal.
                    </p>
                  </div>
                  <label className={formLabelClass}>
                    <span className={formLabelTextClass}>On-chain title · max 96 bytes</span>
                    <input
                      {...validation.fieldProps('name')}
                      className={textInputClass}
                      name="name"
                      defaultValue={proposal.title}
                      maxLength={80}
                      required
                    />
                    <FormFieldError {...validation.errorProps('name')} />
                  </label>
                  <label className={formLabelClass}>
                    <span className={formLabelTextClass}>Internal slug</span>
                    <input
                      {...validation.fieldProps('slug')}
                      className={textInputClass}
                      name="slug"
                      defaultValue={`${proposal.slug}-goal`}
                      onInput={(event) => {
                        event.currentTarget.value = normalizeSlugSpaces(event.currentTarget.value);
                      }}
                      pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                      required
                    />
                    <FormFieldError {...validation.errorProps('slug')} />
                  </label>
                  <label className={formLabelClass}>
                    <span className={formLabelTextClass}>Cadence</span>
                    <select
                      className={selectClass}
                      name="cadence"
                      value={conversionCadence}
                      onChange={(event) =>
                        setConversionCadence(event.target.value as 'ONE_TIME' | 'MONTHLY')
                      }
                    >
                      <option value="ONE_TIME">One-time</option>
                      <option value="MONTHLY">Monthly</option>
                    </select>
                  </label>
                  {conversionCadence === 'ONE_TIME' ? (
                    <label className={formLabelClass}>
                      <span className={formLabelTextClass}>Deadline</span>
                      <input
                        {...validation.fieldProps('deadline')}
                        className={textInputClass}
                        name="deadline"
                        type="datetime-local"
                        required
                      />
                      <FormFieldError {...validation.errorProps('deadline')} />
                    </label>
                  ) : (
                    <>
                      <label className={formLabelClass}>
                        <span className={formLabelTextClass}>Monthly surplus policy</span>
                        <select
                          {...validation.fieldProps('monthlySurplusPolicy')}
                          className={selectClass}
                          name="monthlySurplusPolicy"
                          required
                        >
                          <option value="PAYOUT_ALL">
                            Payout all · allocate the full period balance
                          </option>
                          <option value="ROLL_OVER">
                            Roll over · carry surplus to the next month
                          </option>
                        </select>
                        <FormFieldError {...validation.errorProps('monthlySurplusPolicy')} />
                        <small className="text-[10px] leading-4 text-muted">
                          Payout all makes the whole period balance payable to the recipient. Roll
                          over makes up to the monthly target payable and carries the excess
                          forward. Settlement records the amounts; payout is a separate action.
                        </small>
                      </label>
                      <MonthlyScheduleFields
                        dateFieldProps={validation.fieldProps('firstSettlementAt')}
                        dateError={
                          <FormFieldError {...validation.errorProps('firstSettlementAt')} />
                        }
                      />
                    </>
                  )}
                  <label className={formLabelClass}>
                    <span className={formLabelTextClass}>On-chain purpose · max 512 bytes</span>
                    <textarea
                      {...validation.fieldProps('purpose')}
                      className={textareaClass}
                      name="purpose"
                      maxLength={400}
                      required
                    />
                    <FormFieldError {...validation.errorProps('purpose')} />
                  </label>
                  <label className={formLabelClass}>
                    <span className={formLabelTextClass}>Recipient</span>
                    <input
                      {...validation.fieldProps('recipientAddress')}
                      className={textInputClass}
                      name="recipientAddress"
                      pattern="0x[a-fA-F0-9]{40}"
                      required
                    />
                    <FormFieldError {...validation.errorProps('recipientAddress')} />
                  </label>
                  <label className={formLabelClass}>
                    <span className={formLabelTextClass}>PRE target</span>
                    <input
                      {...validation.fieldProps('pre')}
                      className={textInputClass}
                      name="pre"
                      defaultValue="0"
                      inputMode="decimal"
                      pattern="(?:0|[1-9]\d*)(?:\.\d+)?"
                    />
                    <FormFieldError {...validation.errorProps('pre')} />
                  </label>
                  <label className={formLabelClass}>
                    <span className={formLabelTextClass}>USDC target</span>
                    <input
                      {...validation.fieldProps('usdc')}
                      className={textInputClass}
                      name="usdc"
                      defaultValue="0"
                      inputMode="decimal"
                      pattern="(?:0|[1-9]\d*)(?:\.\d+)?"
                    />
                    <FormFieldError {...validation.errorProps('usdc')} />
                  </label>
                  <ActionButton variant="primary" className="col-span-full max-sm:col-auto">
                    Create unpublished draft
                  </ActionButton>
                </form>
              ) : null}
            </article>
          ))
        ) : (
          <p className="text-[11px] text-muted">No community proposals yet.</p>
        )}
      </div>
    </section>
  );
}
