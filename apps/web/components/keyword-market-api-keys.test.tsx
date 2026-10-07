import type { AdApiKeyCreateResponse, AdApiKeyView } from '@precommunity/shared';
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTH_CHANGED_EVENT } from '@/lib/auth-events';
import { ApiError } from '@/lib/http';
import { createAdApiKey, getAdApiKeys, revokeAdApiKey } from '@/lib/keyword-market-api';
import type { SessionRole } from '@/lib/session-access';
import { ConfirmationDialog } from './confirmation-dialog';
import { KeywordMarketApiKeys } from './keyword-market-api-keys';

const hooks = vi.hoisted(() => ({
  states: [] as Array<{ value: unknown; update: ReturnType<typeof vi.fn> }>,
  refs: [] as Array<{ current: unknown }>,
  effects: [] as Array<() => (() => void) | undefined>,
  stateIndex: 0,
  refIndex: 0,
}));
const session = vi.hoisted(() => ({
  sessionAddress: '0x1111111111111111111111111111111111111111' as string | undefined,
  sessionRoles: ['SUPER_ADMIN'] as SessionRole[],
  sessionReady: true,
  isLoggingOut: false,
}));

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useCallback: (callback: unknown) => callback,
  useEffect: (callback: () => (() => void) | undefined) => hooks.effects.push(callback),
  useRef: (current: unknown) => (hooks.refs[hooks.refIndex++] ??= { current }),
  useState: (initial: unknown) => {
    const index = hooks.stateIndex++;
    const cell = (hooks.states[index] ??= {
      value: initial,
      update: vi.fn((next: unknown) => {
        cell.value = typeof next === 'function' ? next(cell.value) : next;
      }),
    });
    return [cell.value, cell.update];
  },
}));
vi.mock('@/hooks/use-wallet-session', () => ({ useWalletSession: () => session }));
vi.mock('@/lib/keyword-market-api', () => ({
  createAdApiKey: vi.fn(),
  getAdApiKeys: vi.fn(),
  revokeAdApiKey: vi.fn(),
}));

type ElementProps = {
  children?: ReactNode;
  placeholder?: string;
  readOnly?: boolean;
  value?: string;
  disabled?: boolean;
  onSubmit?: (event: { preventDefault: () => void }) => Promise<void>;
  onChange?: (event: { target: { value: string } }) => void;
  onClick?: () => void | Promise<void>;
  onConfirm?: () => void;
};

function elements(node: ReactNode): ReactElement<ElementProps>[] {
  if (!isValidElement<ElementProps>(node)) return [];
  return [node, ...Children.toArray(node.props.children).flatMap(elements)];
}
function renderKeys() {
  hooks.stateIndex = 0;
  hooks.refIndex = 0;
  hooks.effects.length = 0;
  return KeywordMarketApiKeys();
}
function button(tree: ReactNode, name: string) {
  return elements(tree).find(
    (element) => element.props.children === name && element.props.onClick,
  )!;
}
function enterName(value: string) {
  elements(renderKeys()).find((element) => element.props.placeholder === 'Search engine name')!
    .props.onChange!({ target: { value } });
}
function submit() {
  return elements(renderKeys()).find((element) => element.props.onSubmit)!.props.onSubmit!({
    preventDefault: vi.fn(),
  });
}

const key: AdApiKeyView = {
  id: 'key-1',
  name: 'Search One',
  prefix: 'pre_ads_1234',
  createdAt: '2026-10-07T10:00:00.000Z',
  lastUsedAt: null,
  revokedAt: null,
};
const created: AdApiKeyCreateResponse = { ...key, id: 'key-created', apiKey: 'one-time-secret' };

describe('API keys workspace', () => {
  let cleanup: (() => void) | undefined;

  beforeEach(() => {
    hooks.states.length = 0;
    hooks.refs.length = 0;
    vi.clearAllMocks();
    Object.assign(session, {
      sessionAddress: '0x1111111111111111111111111111111111111111',
      sessionRoles: ['SUPER_ADMIN'],
      sessionReady: true,
      isLoggingOut: false,
    });
    vi.stubGlobal('window', new EventTarget());
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    vi.mocked(getAdApiKeys).mockResolvedValue([key]);
    vi.mocked(createAdApiKey).mockResolvedValue(created);
    vi.mocked(revokeAdApiKey).mockResolvedValue(undefined);
  });
  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    vi.unstubAllGlobals();
  });

  async function mount() {
    renderKeys();
    cleanup = hooks.effects[0]!();
    await vi.waitFor(() => expect(hooks.states[4]!.value).toBe('ready'));
    return renderKeys();
  }

  it.each(
    [[], ['CONTENT_ADMIN'], ['FINANCE_ADMIN']].map((roles) => ({ roles: roles as SessionRole[] })),
  )('does not load keys or expose the creation form without SUPER_ADMIN: $roles', ({ roles }) => {
    session.sessionRoles = roles;
    const tree = renderKeys();
    cleanup = hooks.effects[0]!();
    expect(renderToStaticMarkup(tree)).toContain('SUPER_ADMIN access required');
    expect(renderToStaticMarkup(tree)).not.toContain('<form');
    expect(getAdApiKeys).not.toHaveBeenCalled();
  });

  it('requires a session even when stale role metadata exists', () => {
    session.sessionAddress = undefined;
    const tree = renderKeys();
    cleanup = hooks.effects[0]!();
    expect(renderToStaticMarkup(tree)).toContain('Sign in to manage API keys');
    expect(getAdApiKeys).not.toHaveBeenCalled();
  });

  it('renders only masked metadata and active/revoked states', async () => {
    vi.mocked(getAdApiKeys).mockResolvedValue([
      key,
      {
        ...key,
        id: 'key-2',
        name: 'Search Two',
        revokedAt: '2026-10-07T11:00:00.000Z',
        lastUsedAt: '2026-10-07T10:30:00.000Z',
      },
    ]);
    const html = renderToStaticMarkup(await mount());
    expect(html).toContain('pre_ads_1234…');
    expect(html).toContain('Search Two');
    expect(html).toContain('>Active</td>');
    expect(html).toContain('>Revoked</td>');
    expect(html).toContain('>Never</td>');
    expect(html).not.toContain('one-time-secret');
    expect(html.match(/>Revoke<\/button>/g)).toHaveLength(1);
  });

  it('trims names, shows a created secret once, copies it and discards it on close', async () => {
    await mount();
    enterName('  Search One  ');
    await submit();
    let tree = renderKeys();
    expect(createAdApiKey).toHaveBeenCalledWith('Search One');
    expect(elements(tree).find((element) => element.props.readOnly)?.props.value).toBe(
      'one-time-secret',
    );
    expect(hooks.states[0]!.value).toEqual([{ ...key, id: 'key-created' }, key]);
    expect(JSON.stringify(hooks.states[0]!.value)).not.toContain('one-time-secret');
    await button(tree, 'Copy key').props.onClick!();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('one-time-secret');
    tree = renderKeys();
    expect(renderToStaticMarkup(tree)).toContain('>Copied</button>');
    button(tree, 'Close').props.onClick!();
    expect(hooks.states[2]!.value).toBeNull();
    expect(renderToStaticMarkup(renderKeys())).not.toContain('one-time-secret');
  });

  it('rejects blank and oversized trimmed names before calling the API', async () => {
    await mount();
    for (const value of ['   ', 'a'.repeat(81)]) {
      enterName(value);
      await submit();
      expect(renderToStaticMarkup(renderKeys())).toContain(
        'Enter a name between 1 and 80 characters.',
      );
    }
    expect(createAdApiKey).not.toHaveBeenCalled();
  });

  it('keeps the secret selectable when clipboard access fails', async () => {
    await mount();
    enterName('Search One');
    await submit();
    vi.mocked(navigator.clipboard.writeText).mockRejectedValue(new Error('Clipboard unavailable'));
    await button(renderKeys(), 'Copy key').props.onClick!();
    const html = renderToStaticMarkup(renderKeys());
    expect(html).toContain('Select it and copy it manually.');
    expect(html).toContain('one-time-secret');
  });

  it('clears secret and confirmation on auth changes and hides it while logging out', async () => {
    await mount();
    enterName('Search One');
    await submit();
    button(renderKeys(), 'Revoke').props.onClick!();
    session.isLoggingOut = true;
    expect(renderToStaticMarkup(renderKeys())).not.toContain('one-time-secret');
    window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
    expect(hooks.states[2]!.value).toBeNull();
    expect(hooks.states[7]!.value).toBeNull();
    expect(hooks.states[0]!.value).toEqual([]);
  });

  it.each(['auth change', 'unmount'] as const)(
    'discards a pending created secret after %s',
    async (event) => {
      await mount();
      let finish!: (value: AdApiKeyCreateResponse) => void;
      vi.mocked(createAdApiKey).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      enterName('Search One');
      const pending = submit();
      if (event === 'auth change') window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
      else {
        cleanup?.();
        cleanup = undefined;
      }
      finish(created);
      await pending;
      expect(hooks.states[2]!.value).toBeNull();
      expect(hooks.states[2]!.update).not.toHaveBeenCalledWith(
        expect.objectContaining({ apiKey: 'one-time-secret' }),
      );
    },
  );

  it('requires confirmation before revoking and reloads safe metadata', async () => {
    await mount();
    button(renderKeys(), 'Revoke').props.onClick!();
    expect(revokeAdApiKey).not.toHaveBeenCalled();
    vi.mocked(getAdApiKeys).mockResolvedValue([{ ...key, revokedAt: '2026-10-07T11:00:00.000Z' }]);
    elements(renderKeys()).find((element) => element.type === ConfirmationDialog)!.props
      .onConfirm!();
    await vi.waitFor(() => expect(getAdApiKeys).toHaveBeenCalledTimes(2));
    expect(revokeAdApiKey).toHaveBeenCalledWith('key-1');
    expect(hooks.states[7]!.value).toBeNull();
    await vi.waitFor(() => expect(renderToStaticMarkup(renderKeys())).toContain('>Revoked</td>'));
    expect(hooks.states[5]!.value).toBe('');
  });

  it.each([401, 403])('clears sensitive state on an API %i failure', async (status) => {
    await mount();
    enterName('Search One');
    await submit();
    vi.mocked(getAdApiKeys).mockRejectedValue(new ApiError('Access denied', status));
    await button(renderKeys(), 'Refresh').props.onClick!();
    expect(hooks.states[2]!.value).toBeNull();
    expect(hooks.states[0]!.value).toEqual([]);
    expect(hooks.states[4]!.value).toBe(status === 401 ? 'signed-out' : 'denied');
  });
});
