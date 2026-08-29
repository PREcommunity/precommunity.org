import { Prisma } from '@precommunity/database';
import type { AuthenticatedPrincipal } from './request-context';

interface AuditRecord {
  projectId: string;
  actor: AuthenticatedPrincipal;
  entityType: string;
  entityId: string;
  action: string;
  before?: unknown;
  after?: unknown;
}

export function writeAuditEvent(
  database: Pick<Prisma.TransactionClient, 'auditEvent'>,
  record: AuditRecord,
) {
  return database.auditEvent.create({
    data: {
      projectId: record.projectId,
      actorAddress: record.actor.address,
      entityType: record.entityType,
      entityId: record.entityId,
      action: record.action,
      before: record.before as Prisma.InputJsonValue | undefined,
      after: record.after as Prisma.InputJsonValue | undefined,
    },
  });
}
