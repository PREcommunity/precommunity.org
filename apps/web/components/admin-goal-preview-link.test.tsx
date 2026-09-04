import type { ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AdminGoalDraft } from '@/lib/admin-workspace-types';
import { AdminGoalPreviewLink } from './admin-goal-preview-link';

const draft: AdminGoalDraft = {
  id: 'draft-id',
  subprojectId: 'subproject-id',
  name: 'Request',
  slug: 'request',
  status: 'DRAFT',
  description: 'Internal notes',
  purpose: 'Public description',
  cadence: 'ONE_TIME',
  recipientAddress: '0x1111111111111111111111111111111111111111',
  targets: [],
};
const previewPath = `/preview/goals/${'t'.repeat(43)}`;

function render(overrides: Partial<ComponentProps<typeof AdminGoalPreviewLink>> = {}) {
  return renderToStaticMarkup(
    <AdminGoalPreviewLink
      draft={draft}
      editing={false}
      canManage
      onChange={vi.fn()}
      {...overrides}
    />,
  );
}

function buttonAttributes(html: string, label: string) {
  return [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].find((match) =>
    match[2]!.includes(label),
  )?.[1];
}

describe('administrator preview controls', () => {
  it('offers creation only to administrators who can manage drafts', () => {
    expect(render()).toContain('Create preview link');
    expect(render({ canManage: false })).toBe('');
    expect(render({ draft: { ...draft, status: 'PENDING_CHAIN' } })).toContain(
      'Create preview link',
    );
  });

  it('offers opening, copying and revoking an existing link', () => {
    const html = render({ draft: { ...draft, previewPath } });
    expect(html).toContain('Open preview');
    expect(html).toContain('Copy link');
    expect(html).toContain('Revoke link');
    expect(html).not.toContain('Create preview link');
    expect(html).toContain('latest saved draft');
  });

  it('requires saving edits before creating, opening or copying a preview', () => {
    const create = render({ editing: true });
    expect(buttonAttributes(create, 'Create preview link')).toContain(' disabled=""');
    const shared = render({ editing: true, draft: { ...draft, previewPath } });
    expect(buttonAttributes(shared, 'Open preview')).toContain(' disabled=""');
    expect(buttonAttributes(shared, 'Copy link')).toContain(' disabled=""');
    expect(buttonAttributes(shared, 'Revoke link')).not.toContain(' disabled=""');
    expect(shared).toContain('Save edits first');
  });

  it('keeps mutation controls hidden for finance-only administrators', () => {
    const html = render({ canManage: false, draft: { ...draft, previewPath } });
    expect(html).toContain('Open preview');
    expect(html).toContain('Copy link');
    expect(html).not.toContain('Revoke link');
  });

  it('keeps revocation after publication and hides sharing for archived drafts', () => {
    const html = render({ draft: { ...draft, previewPath, status: 'PUBLISHED' } });
    expect(html).toContain('Revoke link');
    expect(html).toContain('opens the published request');
    expect(render({ draft: { ...draft, status: 'PUBLISHED' } })).toBe('');
    expect(render({ draft: { ...draft, previewPath, status: 'ARCHIVED' } })).toBe('');
  });
});
