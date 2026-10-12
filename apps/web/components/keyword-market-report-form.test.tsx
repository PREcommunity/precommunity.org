import { AD_REPORT_REASONS } from '@precommunity/shared';
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import KeywordMarketReportPage from '@/app/(keyword-market)/keyword-market/reports/[revisionId]/page';
import { reportAd } from '@/lib/keyword-market-api';
import { KeywordMarketReportForm } from './keyword-market-report-form';

const hooks = vi.hoisted(() => ({
  states: [] as Array<{ value: unknown }>,
  refs: [] as Array<{ current: unknown }>,
  stateIndex: 0,
  refIndex: 0,
}));

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useRef: (current: unknown) => (hooks.refs[hooks.refIndex++] ??= { current }),
  useState: (initial: unknown) => {
    const cell = (hooks.states[hooks.stateIndex++] ??= { value: initial });
    return [cell.value, (next: unknown) => (cell.value = next)];
  },
}));
vi.mock('@/lib/keyword-market-api', () => ({ reportAd: vi.fn() }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('not-found');
  },
}));

type ElementProps = {
  children?: ReactNode;
  value?: string;
  disabled?: boolean;
  required?: boolean;
  maxLength?: number;
  onSubmit?: (event: { preventDefault: () => void }) => Promise<void>;
  onChange?: (event: { target: { value: string } }) => void;
};

function elements(node: ReactNode): ReactElement<ElementProps>[] {
  if (!isValidElement<ElementProps>(node)) return [];
  return [node, ...Children.toArray(node.props.children).flatMap(elements)];
}
const revisionId = 'aee7acbf-5a27-4c13-a0c4-4c048bff1b36';
function renderForm() {
  hooks.stateIndex = 0;
  hooks.refIndex = 0;
  return KeywordMarketReportForm({ revisionId });
}
function enter(type: 'select' | 'textarea', value: string) {
  elements(renderForm()).find((element) => element.type === type)!.props.onChange!({
    target: { value },
  });
}
function submit() {
  return elements(renderForm()).find((element) => element.props.onSubmit)!.props.onSubmit!({
    preventDefault: vi.fn(),
  });
}

beforeEach(() => {
  hooks.states.length = 0;
  hooks.refs.length = 0;
  vi.clearAllMocks();
  vi.mocked(reportAd).mockResolvedValue({ accepted: true });
});

describe('public ad report form', () => {
  it('opens without submitting and requires an explicit reason from the shared options', async () => {
    const tree = renderForm();
    const select = elements(tree).find((element) => element.type === 'select')!;
    expect(select.props).toMatchObject({ value: '', required: true });
    expect(
      elements(select)
        .filter((element) => element.type === 'option')
        .map((element) => element.props.value),
    ).toEqual(['', ...AD_REPORT_REASONS]);
    expect(reportAd).not.toHaveBeenCalled();
    await submit();
    expect(renderToStaticMarkup(renderForm())).toContain('Choose a reason for your report.');
    expect(reportAd).not.toHaveBeenCalled();
  });

  it('submits a trimmed comment and shows an accessible acknowledgement', async () => {
    enter('select', 'SCAM_PHISHING');
    enter('textarea', '  This link asks for my password.  ');
    await submit();
    expect(reportAd).toHaveBeenCalledWith(revisionId, {
      reason: 'SCAM_PHISHING',
      comment: 'This link asks for my password.',
    });
    const html = renderToStaticMarkup(renderForm());
    expect(html).toContain('role="status"');
    expect(html).toContain('Report submitted for review.');
    expect(html).not.toContain('<form');
  });

  it('allows a report without an optional comment', async () => {
    enter('select', 'BROKEN_LINK');
    enter('textarea', '   ');
    await submit();
    expect(reportAd).toHaveBeenCalledWith(revisionId, { reason: 'BROKEN_LINK' });
  });

  it('keeps values after an error so the report can be retried', async () => {
    vi.mocked(reportAd).mockRejectedValueOnce(new Error('Please try again later.'));
    enter('select', 'MISLEADING');
    enter('textarea', 'The offer is misleading.');
    await submit();
    const tree = renderForm();
    expect(renderToStaticMarkup(tree)).toContain('role="alert"');
    expect(renderToStaticMarkup(tree)).toContain('Please try again later.');
    expect(elements(tree).find((element) => element.type === 'select')!.props.value).toBe(
      'MISLEADING',
    );
    expect(elements(tree).find((element) => element.type === 'textarea')!.props.value).toBe(
      'The offer is misleading.',
    );
    await submit();
    expect(reportAd).toHaveBeenCalledTimes(2);
    expect(renderToStaticMarkup(renderForm())).toContain('Report submitted for review.');
  });

  it('suppresses duplicate submissions before a pending request finishes', async () => {
    let finish!: (value: { accepted: true }) => void;
    vi.mocked(reportAd).mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    enter('select', 'OTHER');
    const handler = elements(renderForm()).find((element) => element.props.onSubmit)!.props
      .onSubmit!;
    const pending = handler({ preventDefault: vi.fn() });
    await handler({ preventDefault: vi.fn() });
    expect(reportAd).toHaveBeenCalledTimes(1);
    const tree = renderForm();
    expect(elements(tree).find((element) => element.type === 'select')!.props.disabled).toBe(true);
    expect(renderToStaticMarkup(tree)).toContain('Submitting…');
    finish({ accepted: true });
    await pending;
  });

  it('rejects unsupported reasons and comments longer than 500 characters', async () => {
    enter('select', 'UNSUPPORTED');
    await submit();
    enter('select', 'OTHER');
    enter('textarea', 'a'.repeat(501));
    await submit();
    const tree = renderForm();
    expect(elements(tree).find((element) => element.type === 'textarea')!.props.maxLength).toBe(
      500,
    );
    expect(renderToStaticMarkup(tree)).toContain('Keep your comment to 500 characters or fewer.');
    expect(reportAd).not.toHaveBeenCalled();
  });
});

describe('public ad report page', () => {
  it('passes a valid revision ID to the form without writing a report', async () => {
    const page = await KeywordMarketReportPage({ params: Promise.resolve({ revisionId }) });
    expect(page.type).toBe(KeywordMarketReportForm);
    expect(page.props).toEqual({ revisionId });
    expect(reportAd).not.toHaveBeenCalled();
  });

  it.each([
    'not-a-uuid',
    `${revisionId}/reports`,
    revisionId.slice(1),
    revisionId.replace('-a0c4-', '-00c4-'),
    revisionId.replace('-4c13-', '-0c13-'),
  ])('rejects a malformed revision ID: %s', async (value) => {
    await expect(
      KeywordMarketReportPage({ params: Promise.resolve({ revisionId: value }) }),
    ).rejects.toThrow('not-found');
    expect(reportAd).not.toHaveBeenCalled();
  });
});
