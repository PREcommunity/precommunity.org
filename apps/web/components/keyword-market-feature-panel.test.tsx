import { Children, isValidElement, useState, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  APPLICATION_FEATURES_CHANGED_EVENT,
  DISABLED_APPLICATION_FEATURES,
} from '@/lib/application-features';
import { ConfirmationDialog, type ConfirmationDialogProps } from './confirmation-dialog';
import { KeywordMarketFeaturePanel } from './keyword-market-feature-panel';

const featureState = vi.hoisted(() => ({
  enabled: true,
  requireReview: true,
  loading: false,
  refresh: vi.fn(),
  update: vi.fn(),
  dispatch: vi.fn(),
}));

vi.mock('react', async (importOriginal) => {
  const react = await importOriginal<typeof import('react')>();
  return { ...react, useState: vi.fn(react.useState) };
});
vi.mock('@/hooks/use-application-features', () => ({
  useApplicationFeatures: () => ({
    features: {
      keywordMarketEnabled: featureState.enabled,
      keywordMarketRequireReview: featureState.requireReview,
    },
    loading: featureState.loading,
    refresh: featureState.refresh,
  }),
}));
vi.mock('@/lib/http', () => ({ clientApiJson: featureState.update }));

let cells: Array<{ value: unknown; set: (value: unknown) => void }>;

function renderPanel(canManage = true, canModerate = true) {
  let index = 0;
  vi.mocked(useState).mockImplementation((() => {
    const cell = cells[index++]!;
    return [cell.value, cell.set];
  }) as typeof useState);
  return KeywordMarketFeaturePanel({ canManage, canModerate });
}

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  return Children.toArray(node).flatMap((child) => {
    if (!isValidElement<Record<string, unknown>>(child)) return [];
    return [child, ...elements(child.props.children as ReactNode)];
  });
}

function reviewSwitch(panel = renderPanel()) {
  return elements(panel).find((element) => element.props['aria-label'] === 'Require review')!;
}

function dialog(panel = renderPanel()) {
  return elements(panel).find((element) => element.type === ConfirmationDialog)!
    .props as unknown as ConfirmationDialogProps;
}

describe('KeywordMarketFeaturePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    featureState.enabled = true;
    featureState.requireReview = true;
    featureState.loading = false;
    cells = [false, null, null].map((value) => {
      const cell = {
        value: value as unknown,
        set: (next: unknown) => {
          cell.value = typeof next === 'function' ? next(cell.value) : next;
        },
      };
      return cell;
    });
    featureState.update.mockImplementation(async (_path, options) => {
      const body = JSON.parse(options.body);
      return {
        keywordMarketEnabled: body.enabled ?? featureState.enabled,
        keywordMarketRequireReview: body.requireReview ?? featureState.requireReview,
      };
    });
    vi.stubGlobal('window', { dispatchEvent: featureState.dispatch });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('links moderators to the existing ad moderation workspace when the market is enabled', () => {
    const html = renderToStaticMarkup(renderPanel());
    expect(html).toContain('href="/keyword-market/admin"');
  });

  it('does not link to a disabled market', () => {
    featureState.enabled = false;
    const html = renderToStaticMarkup(renderPanel());
    expect(html).not.toContain('href="/keyword-market/admin"');
  });

  it('does not expose moderation to an unauthorized role', () => {
    const html = renderToStaticMarkup(renderPanel(false, false));
    expect(html).not.toContain('href="/keyword-market/admin"');
  });

  it('defaults to required review and shows the current review setting', () => {
    expect(DISABLED_APPLICATION_FEATURES.keywordMarketRequireReview).toBe(true);
    expect(reviewSwitch().props['aria-checked']).toBe(true);
    featureState.requireReview = false;
    expect(reviewSwitch().props['aria-checked']).toBe(false);
    expect(renderToStaticMarkup(renderPanel())).toContain('Require review off');
  });

  it('allows changing required review while the market is hidden', async () => {
    featureState.enabled = false;
    const toggle = reviewSwitch();
    expect(toggle.props.disabled).toBe(false);
    (toggle.props.onClick as () => void)();
    const confirmation = dialog();
    expect(confirmation.open).toBe(true);
    expect(confirmation.description).toContain('Existing pending reviews will stay in moderation');
    expect(featureState.update).not.toHaveBeenCalled();
    confirmation.onConfirm();
    await vi.waitFor(() => expect(cells[0]!.value).toBe(false));
    expect(featureState.update).toHaveBeenCalledWith(
      '/v1/admin/features/keyword-market/review',
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requireReview: false }),
      },
      'Keyword Market setting',
    );
    expect(featureState.refresh).toHaveBeenCalledOnce();
    expect(featureState.dispatch.mock.calls[0]![0].type).toBe(APPLICATION_FEATURES_CHANGED_EVENT);
    expect(cells[1]!.value).toBeNull();
    expect(renderToStaticMarkup(renderPanel())).toContain('review requirement disabled');
  });

  it('can turn required review back on', async () => {
    featureState.requireReview = false;
    (reviewSwitch().props.onClick as () => void)();
    expect(dialog().description).toContain('wait for moderator approval');
    dialog().onConfirm();
    await vi.waitFor(() => expect(cells[0]!.value).toBe(false));
    expect(JSON.parse(featureState.update.mock.calls[0]![1].body)).toEqual({ requireReview: true });
  });

  it('disables review changes for roles without feature management', () => {
    const panel = renderPanel(false, true);
    expect(reviewSwitch(panel).props.disabled).toBe(true);
    cells[1]!.value = 'review';
    dialog(renderPanel(false, true)).onConfirm();
    expect(featureState.update).not.toHaveBeenCalled();
  });

  it('disables the review switch while feature state is loading', () => {
    featureState.loading = true;
    expect(reviewSwitch().props.disabled).toBe(true);
  });

  it('keeps confirmation open and reports a failed review change', async () => {
    featureState.update.mockRejectedValueOnce(new Error('Review setting could not be saved.'));
    (reviewSwitch().props.onClick as () => void)();
    dialog().onConfirm();
    await vi.waitFor(() => expect(cells[0]!.value).toBe(false));
    expect(dialog().open).toBe(true);
    expect(renderToStaticMarkup(renderPanel())).toContain('Review setting could not be saved.');
    expect(featureState.refresh).not.toHaveBeenCalled();
    expect(featureState.dispatch).not.toHaveBeenCalled();
  });

  it('keeps the visibility toggle on its existing endpoint', async () => {
    const toggle = elements(renderPanel()).find(
      (element) => element.props.role === 'switch' && !element.props['aria-label'],
    )!;
    (toggle.props.onClick as () => void)();
    dialog().onConfirm();
    await vi.waitFor(() => expect(cells[0]!.value).toBe(false));
    expect(featureState.update.mock.calls[0]![0]).toBe('/v1/admin/features/keyword-market');
    expect(JSON.parse(featureState.update.mock.calls[0]![1].body)).toEqual({ enabled: false });
  });
});
