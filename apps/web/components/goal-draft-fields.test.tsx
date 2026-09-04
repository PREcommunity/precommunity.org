import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AdminGoalDraft } from '@/lib/admin-workspace-types';
import { parseDocuments, isPositiveAmount } from '@/lib/goal-draft-form';
import { GoalDraftFields } from './goal-draft-fields';
import { useFormValidation } from './form-validation';

function Fields({ draft }: { draft?: AdminGoalDraft }) {
  const validation = useFormValidation();
  return (
    <GoalDraftFields
      draft={draft}
      workspace={[
        { id: 'general', name: 'General', slug: 'general', expenses: [] },
        { id: 'custom', name: 'Custom', slug: 'custom', expenses: [] },
      ]}
      validation={validation}
      cadence={draft?.cadence ?? 'ONE_TIME'}
      setCadence={() => {}}
    >
      <div>metadata preview</div>
    </GoalDraftFields>
  );
}
const draft: AdminGoalDraft = {
  id: 'draft',
  subprojectId: 'custom',
  name: 'Title',
  slug: 'title',
  status: 'DRAFT',
  description: 'Notes',
  purpose: 'Description',
  cadence: 'MONTHLY',
  monthlySurplusPolicy: 'ROLL_OVER',
  firstSettlementAtOverride: '2028-01-31T00:00:00.000Z',
  recipientAddress: '0x1111111111111111111111111111111111111111',
  targets: [{ id: 'target', asset: 'PRE', amount: '12.5' }],
  metadataDocuments: [{ label: 'Document', url: 'https://example.com' }],
};
describe('shared goal draft fields', () => {
  it('preserves create defaults, validation and optional metadata order', () => {
    const html = renderToStaticMarkup(<Fields />);
    expect(html).toContain('General (default)');
    expect(html).toContain('name="deadline"');
    expect(html).toContain('type="datetime-local"');
    expect(html).not.toContain('name="monthlySurplusPolicy"');
    const preInput = html.match(/<input\b[^>]*name="pre"[^>]*>/)?.[0] ?? '';
    expect(preInput).toContain('inputMode="decimal"');
    expect(preInput).toContain('pattern="(?:0|[1-9]');
    expect(preInput).toContain('value="0"');
    expect(html.indexOf('metadata preview')).toBeLessThan(html.indexOf('name="metadataUri"'));
    expect(html).toContain('aria-invalid="false"');
  });
  it('preserves draft values and the custom monthly schedule', () => {
    const html = renderToStaticMarkup(<Fields draft={draft} />);
    expect(html).not.toContain('General (default)');
    expect(html).toContain('value="custom" selected');
    expect(html).toContain('value="12.5"');
    expect(html).toContain('value="ROLL_OVER" selected');
    expect(html).toContain('value="2028-01-31"');
    expect(html).toContain('Document | https://example.com');
    expect(html).not.toContain('name="deadline"');
  });
  it('retains document parsing and exact decimal acceptance', () => {
    expect(
      parseDocuments(
        ' Doc | https://example.com \nBad | javascript:bad\n | https://empty.example\nExtra | http://example.com | ignored',
      ),
    ).toEqual([
      { label: 'Doc', url: 'https://example.com' },
      { label: 'Extra', url: 'http://example.com' },
    ]);
    expect(parseDocuments('')).toEqual([]);
    for (const amount of ['0', '0.00', '-1', '01', '1e3', ''])
      expect(isPositiveAmount(amount)).toBe(false);
    for (const amount of ['1', '0.000000000000000001', '12345678901234567890'])
      expect(isPositiveAmount(amount)).toBe(true);
  });
});
