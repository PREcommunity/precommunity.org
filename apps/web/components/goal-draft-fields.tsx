'use client';

import type { ReactNode } from 'react';
import {
  DEFAULT_SUBPROJECT_NAME,
  DEFAULT_SUBPROJECT_SLUG,
  type GoalDocument,
} from '@precommunity/shared';
import type { AdminGoalDraft, AdminSubproject } from '@/lib/admin-workspace-types';
import { normalizeSlugSpaces } from '@/lib/slug';
import {
  formLabelClass,
  formLabelTextClass,
  selectClass,
  textInputClass,
  textareaClass,
} from './form-control-classes';
import { FormFieldError, type useFormValidation } from './form-validation';
import { MonthlyScheduleFields } from './monthly-schedule-fields';

const wideClass = 'col-span-full max-sm:col-auto';

function documentsValue(documents?: GoalDocument[] | null) {
  return (documents ?? []).map((document) => `${document.label} | ${document.url}`).join('\n');
}

function localDateTimeValue(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  const part = (number: number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())}T${part(date.getHours())}:${part(date.getMinutes())}`;
}

export function GoalDraftFields({
  draft,
  workspace,
  validation,
  cadence,
  setCadence,
  children,
}: {
  draft?: AdminGoalDraft;
  workspace: AdminSubproject[];
  validation: ReturnType<typeof useFormValidation>;
  cadence: 'ONE_TIME' | 'MONTHLY';
  setCadence: (value: 'ONE_TIME' | 'MONTHLY') => void;
  children?: ReactNode;
}) {
  const pre = draft?.targets.find((target) => target.asset === 'PRE')?.amount ?? '0';
  const usdc = draft?.targets.find((target) => target.asset === 'USDC')?.amount ?? '0';
  return (
    <>
      {draft ? (
        <label className={formLabelClass}>
          <span className={formLabelTextClass}>Subproject</span>
          <select className={selectClass} name="subprojectId" defaultValue={draft?.subprojectId}>
            {workspace.map((subproject) => (
              <option key={subproject.id} value={subproject.id}>
                {subproject.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <label className={formLabelClass}>
          <span className={formLabelTextClass}>Subproject · optional</span>
          <select className={selectClass} name="subprojectId" defaultValue="">
            <option value="">{DEFAULT_SUBPROJECT_NAME} (default)</option>
            {workspace
              .filter((item) => item.slug !== DEFAULT_SUBPROJECT_SLUG)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
          </select>
        </label>
      )}
      <label className={formLabelClass}>
        <span className={formLabelTextClass}>Internal slug</span>
        <input
          {...validation.fieldProps('slug')}
          className={textInputClass}
          name="slug"
          defaultValue={draft?.slug}
          onInput={(event) => {
            event.currentTarget.value = normalizeSlugSpaces(event.currentTarget.value);
          }}
          pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
          required
        />
        <FormFieldError {...validation.errorProps('slug')} />
      </label>
      <label className={`${formLabelClass} ${wideClass}`}>
        <span className={formLabelTextClass}>On-chain title · max 96 bytes</span>
        <input
          {...validation.fieldProps('name')}
          className={textInputClass}
          name="name"
          defaultValue={draft?.name}
          required
        />
        <FormFieldError {...validation.errorProps('name')} />
      </label>
      <label className={`${formLabelClass} ${wideClass}`}>
        <span className={formLabelTextClass}>On-chain description · max 512 bytes</span>
        <textarea
          {...validation.fieldProps('description')}
          className={textareaClass}
          name="description"
          defaultValue={draft?.purpose}
          required
        />
        <FormFieldError {...validation.errorProps('description')} />
      </label>
      <label className={`${formLabelClass} ${wideClass}`}>
        <span className={formLabelTextClass}>Internal notes</span>
        <textarea className={textareaClass} name="notes" defaultValue={draft?.description} />
      </label>
      <label className={formLabelClass}>
        <span className={formLabelTextClass}>Category · optional IPFS</span>
        <input className={textInputClass} name="category" defaultValue={draft?.category ?? ''} />
      </label>
      <label className={formLabelClass}>
        <span className={formLabelTextClass}>Cadence</span>
        <select
          className={selectClass}
          name="cadence"
          value={cadence}
          onChange={(event) => setCadence(event.target.value as 'ONE_TIME' | 'MONTHLY')}
        >
          <option value="ONE_TIME">One-time goal</option>
          <option value="MONTHLY">Monthly goal</option>
        </select>
      </label>

      {cadence === 'ONE_TIME' ? (
        <label className={`${formLabelClass} motion-safe:animate-[row-rise_.2s_ease-out]`}>
          <span className={formLabelTextClass}>Deadline</span>
          <input
            {...validation.fieldProps('deadline')}
            className={textInputClass}
            name="deadline"
            type="datetime-local"
            defaultValue={localDateTimeValue(draft?.deadline)}
            required
          />
          <FormFieldError {...validation.errorProps('deadline')} />
        </label>
      ) : (
        <>
          <label className={`${formLabelClass} motion-safe:animate-[row-rise_.2s_ease-out]`}>
            <span className={formLabelTextClass}>Monthly surplus policy</span>
            <select
              {...validation.fieldProps('monthlySurplusPolicy')}
              className={selectClass}
              name="monthlySurplusPolicy"
              defaultValue={draft?.monthlySurplusPolicy ?? ''}
              required
            >
              <option value="" disabled>
                Choose a policy
              </option>
              <option value="PAYOUT_ALL">Payout all · allocate the full period balance</option>
              <option value="ROLL_OVER">Roll over · carry surplus to the next month</option>
            </select>
            <FormFieldError {...validation.errorProps('monthlySurplusPolicy')} />
            <small className="text-[10px] leading-4 text-muted">
              Payout all makes the whole period balance payable to the recipient. Roll over makes up
              to the monthly target payable and carries the excess forward. Settlement records the
              amounts; payout is a separate action.
            </small>
          </label>
          <MonthlyScheduleFields
            initialFirstSettlementAt={draft?.firstSettlementAtOverride}
            dateFieldProps={validation.fieldProps('firstSettlementAt')}
            dateError={<FormFieldError {...validation.errorProps('firstSettlementAt')} />}
          />
        </>
      )}

      <label className={`${formLabelClass} ${wideClass}`}>
        <span className={formLabelTextClass}>Recipient EOA or contract</span>
        <input
          {...validation.fieldProps('recipientAddress')}
          className={textInputClass}
          name="recipientAddress"
          defaultValue={draft?.recipientAddress}
          pattern="0x[a-fA-F0-9]{40}"
          required
        />
        <FormFieldError {...validation.errorProps('recipientAddress')} />
      </label>
      <label className={`${formLabelClass} ${wideClass}`}>
        <span className={formLabelTextClass}>Discussion URL · optional IPFS</span>
        <input
          {...validation.fieldProps('discussionUrl')}
          className={textInputClass}
          name="discussionUrl"
          type="url"
          defaultValue={draft?.discussionUrl ?? ''}
        />
        <FormFieldError {...validation.errorProps('discussionUrl')} />
      </label>
      <label className={`${formLabelClass} ${wideClass}`}>
        <span className={formLabelTextClass}>Documents · one `Label | https://…` per line</span>
        <textarea
          className={textareaClass}
          name="documents"
          defaultValue={documentsValue(draft?.metadataDocuments)}
        />
      </label>
      <label className={formLabelClass}>
        <span className={formLabelTextClass}>PRE target</span>
        <input
          {...validation.fieldProps('pre')}
          className={textInputClass}
          name="pre"
          inputMode="decimal"
          defaultValue={pre}
          pattern="(?:0|[1-9]\d*)(?:\.\d+)?"
          required
        />
        <FormFieldError {...validation.errorProps('pre')} />
      </label>
      <label className={formLabelClass}>
        <span className={formLabelTextClass}>USDC target</span>
        <input
          {...validation.fieldProps('usdc')}
          className={textInputClass}
          name="usdc"
          inputMode="decimal"
          defaultValue={usdc}
          pattern="(?:0|[1-9]\d*)(?:\.\d+)?"
          required
        />
        <FormFieldError {...validation.errorProps('usdc')} />
      </label>
      {children}
      <label className={`${formLabelClass} ${wideClass}`}>
        <span className={formLabelTextClass}>Verified IPFS URI · optional</span>
        <input
          {...validation.fieldProps('metadataUri')}
          className={textInputClass}
          name="metadataUri"
          defaultValue={draft?.metadataUri ?? ''}
          placeholder="ipfs://bafy…"
          pattern="ipfs://(?:Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{20,})(?:/\S*)?"
        />
        <FormFieldError {...validation.errorProps('metadataUri')} />
      </label>
    </>
  );
}
