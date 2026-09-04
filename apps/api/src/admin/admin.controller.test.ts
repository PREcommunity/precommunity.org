import 'reflect-metadata';
import { ParseUUIDPipe } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { Role } from '@precommunity/database';
import { describe, expect, it } from 'vitest';
import { ROLES_KEY } from '../common/roles';
import { AdminController } from './admin.controller';

function routePipes(method: string) {
  const metadata = Reflect.getMetadata(ROUTE_ARGS_METADATA, AdminController, method) as
    Record<string, { pipes?: unknown[] }> | undefined;
  return Object.values(metadata ?? {}).flatMap((argument) => argument.pipes ?? []);
}

function routeRoles(method: keyof AdminController) {
  return Reflect.getMetadata(ROLES_KEY, AdminController.prototype[method]) as Role[] | undefined;
}

describe('AdminController identifiers', () => {
  it.each([
    'convertProposal',
    'updateExpense',
    'archiveExpense',
    'createExpensePreviewLink',
    'revokeExpensePreviewLink',
    'publishExpense',
    'markExpenseSubmitted',
    'close',
    'cancel',
    'createSafePayoutIntent',
    'submitSafePayoutProposal',
    'cancelManualSafePayout',
    'submitSafeGoalManagerIntent',
    'moderateProfile',
  ])('validates the UUID path parameter on %s', (method) => {
    expect(routePipes(method)).toContain(ParseUUIDPipe);
  });
});

describe('AdminController Safe ownership authorization', () => {
  it('restricts preview link changes to content and super administrators', () => {
    expect(routeRoles('createExpensePreviewLink')).toEqual([Role.SUPER_ADMIN, Role.CONTENT_ADMIN]);
    expect(routeRoles('revokeExpensePreviewLink')).toEqual([Role.SUPER_ADMIN, Role.CONTENT_ADMIN]);
  });

  it('leaves Safe status and acceptance available to any authenticated wallet', () => {
    expect(routeRoles('safeStatus')).toBeUndefined();
    expect(routeRoles('prepareSafeOwnershipAcceptance')).toBeUndefined();
    expect(routeRoles('submitSafeOwnershipAcceptance')).toBeUndefined();
  });

  it('keeps the initial ownership transfer restricted to the current root administrator', () => {
    expect(routeRoles('prepareSafeOwnershipTransfer')).toEqual([Role.SUPER_ADMIN]);
  });

  it('restricts manual payout cancellation to finance administrators', () => {
    expect(routeRoles('cancelManualSafePayout')).toEqual([Role.SUPER_ADMIN, Role.FINANCE_ADMIN]);
  });

  it('restricts goal manager mutations to root administrators', () => {
    expect(routeRoles('prepareSafeGoalManagerSync')).toEqual([Role.SUPER_ADMIN]);
    expect(routeRoles('updateGoalManager')).toEqual([Role.SUPER_ADMIN]);
    expect(routeRoles('submitSafeGoalManagerIntent')).toEqual([Role.SUPER_ADMIN]);
  });

  it('lets every workspace administrator request a goal manager data refresh', () => {
    expect(routeRoles('refreshGoalManagers')).toEqual([
      Role.SUPER_ADMIN,
      Role.CONTENT_ADMIN,
      Role.FINANCE_ADMIN,
    ]);
  });
});
