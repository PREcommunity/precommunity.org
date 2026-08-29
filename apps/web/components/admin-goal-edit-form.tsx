'use client';

import { type FormEvent, useState } from 'react';
import type { GoalDocument } from '@precommunity/shared';
import type {
  AdminGoalDraft,
  AdminGoalDraftUpdateInput,
  AdminSubproject,
} from '@/lib/admin-workspace-types';
import { normalizeSlugSpaces } from '@/lib/slug';
import { ActionButton } from './action-button';
import {
  formLabelClass,
  formLabelTextClass,
  selectClass,
  textInputClass,
  textareaClass,
} from './form-control-classes';
import { FormFieldError, useFormValidation } from './form-validation';
import { MonthlyScheduleFields, utcDateInputToIso } from './monthly-schedule-fields';

const wideClass = 'col-span-full max-sm:col-auto';

function optionalString(form: FormData, name: string) {
  return String(form.get(name) ?? '').trim() || null;
}

function positiveAmount(value: string) {
  return /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) && !/^0(?:\.0+)?$/.test(value);
}

function parseDocuments(value: string): GoalDocument[] {
  return value
    .split('\n')
    .map((line) => {
      const [label = '', url = ''] = line.split('|');
      return { label: label.trim(), url: url.trim() };
    })
    .filter((document) => document.label && /^https?:\/\//.test(document.url));
}

function documentsValue(documents?: GoalDocument[] | null) {
  return (documents ?? []).map((document) => `${document.label} | ${document.url}`).join('\n');
}

function localDateTimeValue(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  const part = (number: number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())}T${part(date.getHours())}:${part(date.getMinutes())}`;
}

export function AdminGoalEditForm({
  draft,
  workspace,
  onCancel,
  onSave,
}: {
  draft: AdminGoalDraft;
  workspace: AdminSubproject[];
  onCancel: () => void;
  onSave: (input: AdminGoalDraftUpdateInput) => Promise<boolean>;
}) {
  const [cadence, setCadence] = useState(draft.cadence);
  const [saving, setSaving] = useState(false);
  const validation = useFormValidation();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const pre = String(form.get('pre') ?? '0');
    const usdc = String(form.get('usdc') ?? '0');
    const documents = parseDocuments(String(form.get('documents') ?? ''));
    const firstSettlementAt =
      cadence === 'MONTHLY' && String(form.get('firstSettlementMode')) === 'CUSTOM'
        ? utcDateInputToIso(String(form.get('firstSettlementAt') ?? ''))
        : null;
    if (firstSettlementAt === undefined) return;

    const deadlineValue = String(form.get('deadline') ?? '');
    const input: AdminGoalDraftUpdateInput = {
      subprojectId: optionalString(form, 'subprojectId'),
      name: String(form.get('name') ?? ''),
      slug: normalizeSlugSpaces(String(form.get('slug') ?? '')),
      description: String(form.get('notes') ?? ''),
      purpose: String(form.get('description') ?? ''),
      category: optionalString(form, 'category'),
      cadence,
      monthlySurplusPolicy:
        cadence === 'MONTHLY'
          ? (String(form.get('monthlySurplusPolicy')) as 'PAYOUT_ALL' | 'ROLL_OVER')
          : null,
      firstSettlementAt,
      recipientAddress: String(form.get('recipientAddress') ?? ''),
      deadline: cadence === 'ONE_TIME' ? new Date(deadlineValue).toISOString() : null,
      discussionUrl: optionalString(form, 'discussionUrl'),
      metadataUri: optionalString(form, 'metadataUri'),
      documents,
      targets: (
        [
          { asset: 'PRE', amount: pre },
          { asset: 'USDC', amount: usdc },
        ] as const
      ).filter((target) => positiveAmount(target.amount)),
    };

    setSaving(true);
    try {
      if (await onSave(input)) onCancel();
    } finally {
      setSaving(false);
    }
  }

  const pre = draft.targets.find((target) => target.asset === 'PRE')?.amount ?? '0';
  const usdc = draft.targets.find((target) => target.asset === 'USDC')?.amount ?? '0';

  return (
    <form
      className="col-span-full mt-1 grid grid-cols-2 gap-3.5 border-y border-line bg-white px-4 py-5 motion-safe:animate-[row-rise_.2s_ease-out] max-sm:grid-cols-1"
      onSubmit={(event) => void submit(event)}
      onInvalid={validation.onInvalid}
      onInput={validation.onInput}
    >
      <div className={`${wideClass} flex items-start justify-between gap-4`}>
        <div>
          <span className="font-mono text-[10px] tracking-[.05em] text-blue uppercase">
            Unpublished draft
          </span>
          <h3 className="my-1 text-xl">Edit goal</h3>
          <p className="m-0 text-[11px] text-muted">
            These values will be used by Sign &amp; publish.
          </p>
        </div>
        <button
          className="cursor-pointer border-0 bg-transparent text-xs text-muted hover:text-navy"
          type="button"
          onClick={onCancel}
        >
          Close
        </button>
      </div>

      <label className={formLabelClass}>
        <span className={formLabelTextClass}>Subproject</span>
        <select className={selectClass} name="subprojectId" defaultValue={draft.subprojectId}>
          {workspace.map((subproject) => (
            <option key={subproject.id} value={subproject.id}>
              {subproject.name}
            </option>
          ))}
        </select>
      </label>
      <label className={formLabelClass}>
        <span className={formLabelTextClass}>Internal slug</span>
        <input
          {...validation.fieldProps('slug')}
          className={textInputClass}
          name="slug"
          defaultValue={draft.slug}
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
          defaultValue={draft.name}
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
          defaultValue={draft.purpose}
          required
        />
        <FormFieldError {...validation.errorProps('description')} />
      </label>
      <label className={`${formLabelClass} ${wideClass}`}>
        <span className={formLabelTextClass}>Internal notes</span>
        <textarea className={textareaClass} name="notes" defaultValue={draft.description} />
      </label>
      <label className={formLabelClass}>
        <span className={formLabelTextClass}>Category · optional IPFS</span>
        <input className={textInputClass} name="category" defaultValue={draft.category ?? ''} />
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
            defaultValue={localDateTimeValue(draft.deadline)}
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
              defaultValue={draft.monthlySurplusPolicy ?? ''}
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
            initialFirstSettlementAt={draft.firstSettlementAtOverride}
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
          defaultValue={draft.recipientAddress}
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
          defaultValue={draft.discussionUrl ?? ''}
        />
        <FormFieldError {...validation.errorProps('discussionUrl')} />
      </label>
      <label className={`${formLabelClass} ${wideClass}`}>
        <span className={formLabelTextClass}>Documents · one `Label | https://…` per line</span>
        <textarea
          className={textareaClass}
          name="documents"
          defaultValue={documentsValue(draft.metadataDocuments)}
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
      <label className={`${formLabelClass} ${wideClass}`}>
        <span className={formLabelTextClass}>Verified IPFS URI · optional</span>
        <input
          {...validation.fieldProps('metadataUri')}
          className={textInputClass}
          name="metadataUri"
          defaultValue={draft.metadataUri ?? ''}
          placeholder="ipfs://bafy…"
          pattern="ipfs://(?:Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{20,})(?:/\S*)?"
        />
        <FormFieldError {...validation.errorProps('metadataUri')} />
      </label>

      <div className={`${wideClass} flex justify-end gap-2`}>
        <ActionButton type="button" onClick={onCancel} disabled={saving}>
          Cancel
        </ActionButton>
        <ActionButton variant="primary" type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save changes'}
        </ActionButton>
      </div>
    </form>
  );
}
