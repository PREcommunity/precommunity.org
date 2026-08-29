'use client';

import { type FormEvent, useMemo, useState } from 'react';
import { Copy, Plus } from 'lucide-react';
import {
  DEFAULT_SUBPROJECT_NAME,
  DEFAULT_SUBPROJECT_SLUG,
  canonicalGoalMetadata,
  type GoalDocument,
} from '@precommunity/shared';
import type { AdminGoalDraftInput, AdminSubproject } from '@/lib/admin-workspace-types';
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
import { MonthlyScheduleFields, utcDateInputToIso } from './monthly-schedule-fields';

export { monthlyPeriodPreview } from './monthly-schedule-fields';

interface AdminCreationFormsProps {
  workspace: AdminSubproject[];
  onCreateSubproject: (input: {
    name: string;
    slug: string;
    description?: string;
  }) => Promise<boolean>;
  onCreateGoal: (input: AdminGoalDraftInput) => Promise<boolean>;
}

const formClass =
  'my-5 grid grid-cols-2 gap-3.5 border border-line bg-white p-5 max-sm:grid-cols-1';
const wideClass = 'col-span-full max-sm:col-auto';
const metadataFieldNames = ['subprojectId', 'category', 'discussionUrl', 'documents'] as const;

type MetadataFieldName = (typeof metadataFieldNames)[number];

function isMetadataFieldName(name: string): name is MetadataFieldName {
  return metadataFieldNames.some((fieldName) => fieldName === name);
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

function isPositiveAmount(value: string) {
  return /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) && !/^0(?:\.0+)?$/.test(value);
}

function optionalFormString(form: FormData, name: string) {
  const value = String(form.get(name) ?? '').trim();
  return value || undefined;
}

export function AdminCreationForms({
  workspace,
  onCreateSubproject,
  onCreateGoal,
}: AdminCreationFormsProps) {
  const [showGoalForm, setShowGoalForm] = useState(false);
  const [cadence, setCadence] = useState<'ONE_TIME' | 'MONTHLY'>('ONE_TIME');
  const [showSubprojectForm, setShowSubprojectForm] = useState(false);
  const subprojectValidation = useFormValidation();
  const goalValidation = useFormValidation();
  const [metadataFields, setMetadataFields] = useState({
    subprojectId: '',
    category: '',
    discussionUrl: '',
    documents: '',
  });
  const metadata = useMemo(() => {
    const subproject = workspace.find((item) => item.id === metadataFields.subprojectId);
    return canonicalGoalMetadata({
      category: metadataFields.category,
      subproject: subproject ? { name: subproject.name, slug: subproject.slug } : undefined,
      discussionUrl: metadataFields.discussionUrl,
      documents: parseDocuments(metadataFields.documents),
    });
  }, [metadataFields, workspace]);
  const hasOptionalMetadata = Object.keys(metadata).length > 1;

  function toggleGoalForm() {
    if (showGoalForm) {
      setShowGoalForm(false);
      return;
    }
    setMetadataFields({ subprojectId: '', category: '', discussionUrl: '', documents: '' });
    goalValidation.reset();
    setCadence('ONE_TIME');
    setShowGoalForm(true);
  }

  async function submitSubproject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const saved = await onCreateSubproject({
      name: String(form.get('name') ?? ''),
      slug: String(form.get('slug') ?? ''),
      description: optionalFormString(form, 'description'),
    });
    if (saved) setShowSubprojectForm(false);
  }

  async function submitGoal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const pre = String(form.get('pre') ?? '0');
    const usdc = String(form.get('usdc') ?? '0');
    const metadataUri = optionalFormString(form, 'metadataUri');
    const documents = parseDocuments(String(form.get('documents') ?? ''));
    const selectedCadence = String(form.get('cadence') ?? 'ONE_TIME') as 'ONE_TIME' | 'MONTHLY';
    const deadlineValue = String(form.get('deadline') ?? '');
    const firstSettlementAt = utcDateInputToIso(String(form.get('firstSettlementAt') ?? ''));
    const saved = await onCreateGoal({
      subprojectId: optionalFormString(form, 'subprojectId'),
      name: String(form.get('name') ?? ''),
      slug: normalizeSlugSpaces(String(form.get('slug') ?? '')),
      description: String(form.get('notes') ?? ''),
      purpose: String(form.get('description') ?? ''),
      category: optionalFormString(form, 'category'),
      cadence: selectedCadence,
      ...(selectedCadence === 'MONTHLY'
        ? {
            monthlySurplusPolicy: String(form.get('monthlySurplusPolicy')) as
              'PAYOUT_ALL' | 'ROLL_OVER',
            ...(firstSettlementAt ? { firstSettlementAt } : {}),
          }
        : { deadline: new Date(deadlineValue).toISOString() }),
      recipientAddress: String(form.get('recipientAddress') ?? ''),
      discussionUrl: optionalFormString(form, 'discussionUrl'),
      metadataUri,
      documents: documents.length ? documents : undefined,
      targets: (
        [
          { asset: 'PRE', amount: pre },
          { asset: 'USDC', amount: usdc },
        ] as const
      ).filter((target) => isPositiveAmount(target.amount)),
    });
    if (saved) setShowGoalForm(false);
  }

  return (
    <>
      <div className="mt-6 flex justify-between gap-5 border-y border-line py-3 max-sm:flex-col">
        <div className="flex flex-col">
          <strong>
            {workspace.reduce((sum, item) => sum + item.expenses.length, 0)} goal drafts
          </strong>
          <span className="text-[11px] text-muted">across {workspace.length} subprojects</span>
        </div>
        <span className="flex gap-[7px]">
          <ActionButton
            size="compact"
            icon={<Plus size={15} />}
            className="text-[11px]"
            onClick={() => setShowSubprojectForm((value) => !value)}
          >
            Subproject
          </ActionButton>
          <ActionButton
            variant="primary"
            size="compact"
            icon={<Plus size={15} />}
            className="text-[11px]"
            onClick={toggleGoalForm}
          >
            Goal draft
          </ActionButton>
        </span>
      </div>

      {showSubprojectForm ? (
        <form
          className={formClass}
          onSubmit={(event) => void submitSubproject(event)}
          onInvalid={subprojectValidation.onInvalid}
          onInput={subprojectValidation.onInput}
        >
          <div className={`${wideClass} flex justify-between`}>
            <div>
              <span className="font-mono text-[11px] tracking-[.05em] text-blue uppercase">
                Organization
              </span>
              <h2 className="my-1 text-[22px]">New subproject</h2>
            </div>
            <button
              className="cursor-pointer border-0 bg-transparent"
              type="button"
              onClick={() => setShowSubprojectForm(false)}
            >
              Close
            </button>
          </div>
          <label className={formLabelClass}>
            <span className={formLabelTextClass}>Name</span>
            <input
              {...subprojectValidation.fieldProps('name')}
              className={textInputClass}
              name="name"
              required
            />
            <FormFieldError {...subprojectValidation.errorProps('name')} />
          </label>
          <label className={formLabelClass}>
            <span className={formLabelTextClass}>Slug</span>
            <input
              {...subprojectValidation.fieldProps('slug')}
              className={textInputClass}
              name="slug"
              pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
              required
            />
            <FormFieldError {...subprojectValidation.errorProps('slug')} />
          </label>
          <label className={`${formLabelClass} ${wideClass}`}>
            <span className={formLabelTextClass}>Description</span>
            <textarea className={textareaClass} name="description" />
          </label>
          <ActionButton variant="primary" className={wideClass}>
            Save subproject
          </ActionButton>
        </form>
      ) : null}

      {showGoalForm ? (
        <form
          className={formClass}
          onSubmit={(event) => void submitGoal(event)}
          onInvalid={goalValidation.onInvalid}
          onInput={(event) => {
            const target = event.target as
              HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
            goalValidation.onInput(event);
            if (isMetadataFieldName(target.name)) {
              const fieldName = target.name;
              setMetadataFields((fields) => ({ ...fields, [fieldName]: target.value }));
            }
          }}
        >
          <div className={`${wideClass} flex justify-between`}>
            <div>
              <span className="font-mono text-[11px] tracking-[.05em] text-blue uppercase">
                Unpublished record
              </span>
              <h2 className="my-1 text-[22px]">Create goal draft</h2>
            </div>
            <button
              className="cursor-pointer border-0 bg-transparent"
              type="button"
              onClick={() => setShowGoalForm(false)}
            >
              Close
            </button>
          </div>
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
          <label className={formLabelClass}>
            <span className={formLabelTextClass}>Internal slug</span>
            <input
              {...goalValidation.fieldProps('slug')}
              className={textInputClass}
              name="slug"
              onInput={(event) => {
                event.currentTarget.value = normalizeSlugSpaces(event.currentTarget.value);
              }}
              pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
              required
            />
            <FormFieldError {...goalValidation.errorProps('slug')} />
          </label>
          <label className={`${formLabelClass} ${wideClass}`}>
            <span className={formLabelTextClass}>On-chain title · max 96 bytes</span>
            <input
              {...goalValidation.fieldProps('name')}
              className={textInputClass}
              name="name"
              required
            />
            <FormFieldError {...goalValidation.errorProps('name')} />
          </label>
          <label className={`${formLabelClass} ${wideClass}`}>
            <span className={formLabelTextClass}>On-chain description · max 512 bytes</span>
            <textarea
              {...goalValidation.fieldProps('description')}
              className={textareaClass}
              name="description"
              required
            />
            <FormFieldError {...goalValidation.errorProps('description')} />
          </label>
          <label className={`${formLabelClass} ${wideClass}`}>
            <span className={formLabelTextClass}>Internal notes</span>
            <textarea className={textareaClass} name="notes" />
          </label>
          <label className={formLabelClass}>
            <span className={formLabelTextClass}>Category · optional IPFS</span>
            <input className={textInputClass} name="category" />
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
                {...goalValidation.fieldProps('deadline')}
                className={textInputClass}
                name="deadline"
                type="datetime-local"
                required
              />
              <FormFieldError {...goalValidation.errorProps('deadline')} />
            </label>
          ) : (
            <>
              <label className={`${formLabelClass} motion-safe:animate-[row-rise_.2s_ease-out]`}>
                <span className={formLabelTextClass}>Monthly surplus policy</span>
                <select
                  {...goalValidation.fieldProps('monthlySurplusPolicy')}
                  className={selectClass}
                  name="monthlySurplusPolicy"
                  defaultValue=""
                  required
                >
                  <option value="" disabled>
                    Choose a policy
                  </option>
                  <option value="PAYOUT_ALL">Payout all · allocate the full period balance</option>
                  <option value="ROLL_OVER">Roll over · carry surplus to the next month</option>
                </select>
                <FormFieldError {...goalValidation.errorProps('monthlySurplusPolicy')} />
                <small className="text-[10px] leading-4 text-muted">
                  Payout all makes the whole period balance payable to the recipient. Roll over
                  makes up to the monthly target payable and carries the excess forward. Settlement
                  records the amounts; payout is a separate action.
                </small>
              </label>
              <MonthlyScheduleFields
                dateFieldProps={goalValidation.fieldProps('firstSettlementAt')}
                dateError={<FormFieldError {...goalValidation.errorProps('firstSettlementAt')} />}
              />
            </>
          )}
          <label className={`${formLabelClass} ${wideClass}`}>
            <span className={formLabelTextClass}>Recipient EOA or contract</span>
            <input
              {...goalValidation.fieldProps('recipientAddress')}
              className={textInputClass}
              name="recipientAddress"
              pattern="0x[a-fA-F0-9]{40}"
              required
            />
            <FormFieldError {...goalValidation.errorProps('recipientAddress')} />
          </label>
          <label className={`${formLabelClass} ${wideClass}`}>
            <span className={formLabelTextClass}>Discussion URL · optional IPFS</span>
            <input
              {...goalValidation.fieldProps('discussionUrl')}
              className={textInputClass}
              name="discussionUrl"
              type="url"
            />
            <FormFieldError {...goalValidation.errorProps('discussionUrl')} />
          </label>
          <label className={`${formLabelClass} ${wideClass}`}>
            <span className={formLabelTextClass}>Documents · one `Label | https://…` per line</span>
            <textarea className={textareaClass} name="documents" />
          </label>
          <label className={formLabelClass}>
            <span className={formLabelTextClass}>PRE target</span>
            <input
              {...goalValidation.fieldProps('pre')}
              className={textInputClass}
              name="pre"
              inputMode="decimal"
              defaultValue="0"
              pattern="(?:0|[1-9]\d*)(?:\.\d+)?"
              required
            />
            <FormFieldError {...goalValidation.errorProps('pre')} />
          </label>
          <label className={formLabelClass}>
            <span className={formLabelTextClass}>USDC target</span>
            <input
              {...goalValidation.fieldProps('usdc')}
              className={textInputClass}
              name="usdc"
              inputMode="decimal"
              defaultValue="0"
              pattern="(?:0|[1-9]\d*)(?:\.\d+)?"
              required
            />
            <FormFieldError {...goalValidation.errorProps('usdc')} />
          </label>
          <div className={`${wideClass} bg-navy text-white`}>
            <div className="flex justify-between border-b border-[#2c465f] px-3 py-2.5">
              <strong>Optional IPFS metadata</strong>
              {hasOptionalMetadata ? (
                <button
                  className="cursor-pointer border-0 bg-transparent text-[#9bcaff]"
                  type="button"
                  onClick={() =>
                    void navigator.clipboard.writeText(JSON.stringify(metadata, null, 2))
                  }
                >
                  <Copy size={13} /> Copy
                </button>
              ) : null}
            </div>
            {hasOptionalMetadata ? (
              <>
                <pre className="m-0 max-h-[220px] overflow-auto p-3 text-[10px]">
                  {JSON.stringify(metadata, null, 2)}
                </pre>
                <p className="px-3 pb-3 text-[#b9c9da]">
                  Pin this exact JSON only if you want to publish these optional details.
                </p>
              </>
            ) : (
              <p className="px-3 pb-3 text-[#b9c9da]">
                No optional metadata added. You can publish this goal without an IPFS CID.
              </p>
            )}
          </div>
          <label className={`${formLabelClass} ${wideClass}`}>
            <span className={formLabelTextClass}>Verified IPFS URI · optional</span>
            <input
              {...goalValidation.fieldProps('metadataUri')}
              className={textInputClass}
              name="metadataUri"
              placeholder="ipfs://bafy…"
              pattern="ipfs://(?:Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{20,})(?:/\S*)?"
            />
            <FormFieldError {...goalValidation.errorProps('metadataUri')} />
          </label>
          <ActionButton variant="primary" className={wideClass} type="submit">
            Save unpublished draft
          </ActionButton>
        </form>
      ) : null}
    </>
  );
}
