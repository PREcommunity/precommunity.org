'use client';

import { type FormEvent, useState } from 'react';
import type {
  AdminGoalDraft,
  AdminGoalDraftUpdateInput,
  AdminSubproject,
} from '@/lib/admin-workspace-types';
import { normalizeSlugSpaces } from '@/lib/slug';
import { GoalDraftFields } from './goal-draft-fields';
import { parseDocuments, isPositiveAmount } from '@/lib/goal-draft-form';
import { ActionButton } from './action-button';
import { useFormValidation } from './form-validation';
import { utcDateInputToIso } from './monthly-schedule-fields';

const wideClass = 'col-span-full max-sm:col-auto';

function optionalString(form: FormData, name: string) {
  return String(form.get(name) ?? '').trim() || null;
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
      ).filter((target) => isPositiveAmount(target.amount)),
    };

    setSaving(true);
    try {
      if (await onSave(input)) onCancel();
    } finally {
      setSaving(false);
    }
  }

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

      <GoalDraftFields
        draft={draft}
        workspace={workspace}
        validation={validation}
        cadence={cadence}
        setCadence={setCadence}
      />

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
