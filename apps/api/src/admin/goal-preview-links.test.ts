import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ExpenseStatus, Role } from '@precommunity/database';
import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedPrincipal } from '../common/request-context';
import type { PrismaService } from '../common/prisma.service';
import { AdminService } from './admin.service';

const actor: AuthenticatedPrincipal = {
  userId: 'admin-id',
  address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  roles: [Role.CONTENT_ADMIN],
  chainAuthorities: [],
  chainOwnerAddress: null,
  safeOwner: false,
  canAccessSafeOwnershipAcceptance: false,
  safeAddress: null,
};

function previewWorkspace(status: ExpenseStatus = ExpenseStatus.DRAFT) {
  const draft = {
    id: 'draft-id',
    status,
    archivedAt: null as Date | null,
    previewToken: null as string | null,
  };
  const expense = {
    findFirst: vi.fn(async ({ where }) =>
      where.id !== draft.id || (where.archivedAt === null && draft.archivedAt)
        ? null
        : { ...draft },
    ),
    updateMany: vi.fn(async ({ where, data }) => {
      if (
        where.id !== draft.id ||
        (where.status && !where.status.in.includes(draft.status)) ||
        (where.archivedAt === null && draft.archivedAt) ||
        (where.previewToken === null && draft.previewToken !== null) ||
        (where.previewToken?.not === null && draft.previewToken === null)
      )
        return { count: 0 };
      draft.previewToken = data.previewToken;
      return { count: 1 };
    }),
    update: vi.fn(async ({ data }) => Object.assign(draft, data)),
  };
  const tx = { expense, auditEvent: { create: vi.fn().mockResolvedValue({}) } };
  const prisma = {
    project: { findUnique: vi.fn().mockResolvedValue({ id: 'project-id' }) },
    $transaction: vi.fn(async (callback: (database: typeof tx) => unknown) => callback(tx)),
  } as unknown as PrismaService;
  return { draft, tx, service: new AdminService(prisma) };
}

describe('goal preview link management', () => {
  it.each([ExpenseStatus.DRAFT, ExpenseStatus.PENDING_CHAIN])(
    'lets a content administrator without chain authority share a %s request',
    async (status) => {
      const { draft, tx, service } = previewWorkspace(status);
      const result = await service.createExpensePreviewLink(draft.id, actor);
      expect(result.previewPath).toMatch(/^\/preview\/goals\/[A-Za-z0-9_-]{43}$/);
      expect(Buffer.from(draft.previewToken!, 'base64url')).toHaveLength(32);
      expect(draft.status).toBe(status);
      expect(tx.expense.updateMany).toHaveBeenCalledWith({
        where: {
          id: draft.id,
          subproject: { projectId: 'project-id' },
          status: { in: [ExpenseStatus.DRAFT, ExpenseStatus.PENDING_CHAIN] },
          archivedAt: null,
          previewToken: null,
        },
        data: { previewToken: draft.previewToken },
      });
      expect(Object.keys(tx.expense.updateMany.mock.calls[0]![0].data)).toEqual(['previewToken']);
    },
  );

  it('atomically reuses one token for concurrent and repeated creation requests', async () => {
    const { draft, tx, service } = previewWorkspace();
    const links = await Promise.all(
      Array.from({ length: 3 }, () => service.createExpensePreviewLink(draft.id, actor)),
    );
    expect(new Set(links.map((link) => link.previewPath)).size).toBe(1);
    await expect(service.createExpensePreviewLink(draft.id, actor)).resolves.toEqual(links[0]);
    expect(tx.auditEvent.create).toHaveBeenCalledOnce();
    expect(JSON.stringify(tx.auditEvent.create.mock.calls)).not.toContain(draft.previewToken);
  });

  it('revokes idempotently and generates a different token when sharing is enabled again', async () => {
    const { draft, tx, service } = previewWorkspace();
    const first = await service.createExpensePreviewLink(draft.id, actor);
    await expect(service.revokeExpensePreviewLink(draft.id, actor)).resolves.toEqual({
      previewPath: null,
    });
    expect(draft.previewToken).toBeNull();
    await service.revokeExpensePreviewLink(draft.id, actor);
    const second = await service.createExpensePreviewLink(draft.id, actor);
    expect(second.previewPath).not.toBe(first.previewPath);
    expect(tx.auditEvent.create.mock.calls.map(([call]) => call.data.action)).toEqual([
      'CREATE_PREVIEW_LINK',
      'REVOKE_PREVIEW_LINK',
      'CREATE_PREVIEW_LINK',
    ]);
    const audit = JSON.stringify(tx.auditEvent.create.mock.calls);
    expect(audit).not.toContain(first.previewPath.split('/').at(-1));
    expect(audit).not.toContain(second.previewPath.split('/').at(-1));
  });

  it('allows revocation after publication without changing published state', async () => {
    const { draft, service } = previewWorkspace(ExpenseStatus.PUBLISHED);
    draft.previewToken = 'p'.repeat(43);
    await service.revokeExpensePreviewLink(draft.id, actor);
    expect(draft.previewToken).toBeNull();
    expect(draft.status).toBe(ExpenseStatus.PUBLISHED);
  });

  it.each([ExpenseStatus.PUBLISHED, ExpenseStatus.ARCHIVED])(
    'does not create new links for %s requests',
    async (status) => {
      const { draft, tx, service } = previewWorkspace(status);
      await expect(service.createExpensePreviewLink(draft.id, actor)).rejects.toBeInstanceOf(
        status === ExpenseStatus.ARCHIVED ? NotFoundException : BadRequestException,
      );
      expect(draft.previewToken).toBeNull();
      expect(tx.auditEvent.create).not.toHaveBeenCalled();
    },
  );

  it('rejects missing and archived records and clears a link when archiving', async () => {
    const { draft, service } = previewWorkspace();
    await expect(service.createExpensePreviewLink('missing', actor)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.revokeExpensePreviewLink('missing', actor)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await service.createExpensePreviewLink(draft.id, actor);
    await service.archiveExpense(draft.id, actor);
    expect(draft.previewToken).toBeNull();
    expect(draft.status).toBe(ExpenseStatus.ARCHIVED);
    await expect(service.createExpensePreviewLink(draft.id, actor)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('exposes a relative preview path instead of the token field in the workspace', async () => {
    const token = 't'.repeat(43);
    const prisma = {
      project: { findUnique: vi.fn().mockResolvedValue({ id: 'project-id' }) },
      subproject: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            { id: 'subproject-id', expenses: [{ id: 'draft-id', previewToken: token, goals: [] }] },
          ]),
      },
    } as unknown as PrismaService;
    const workspace = await new AdminService(prisma).list();
    expect(workspace[0]!.expenses[0]).toEqual({
      id: 'draft-id',
      previewPath: `/preview/goals/${token}`,
      goals: [],
    });
  });
});
