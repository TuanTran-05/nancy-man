import { randomUUID } from 'node:crypto';

import { issueEnrollmentToken } from '../../../../../packages/security/src/mfa/enrollmentToken.js';
import type { OpsRole } from '../../../../../packages/security/src/sessions.js';
import type { StepUpBinding, StepUpService } from '../auth/stepUpService.js';

export type OpsAccountStatus = 'pending_mfa' | 'active' | 'locked' | 'revoked';

export type OpsAccountSummary = {
  id: string;
  username: string;
  email: string;
  displayName: string;
  role: OpsRole;
  status: OpsAccountStatus;
  mfaEnrolled: boolean;
  createdAt: string;
  lastLoginAt: string | null;
};

export type AccountRepository = {
  list: () => Promise<readonly OpsAccountSummary[]>;
  findById: (id: string) => Promise<OpsAccountSummary | null>;
  countActiveOwners: () => Promise<number>;
  createPending: (input: {
    id: string;
    username: string;
    email: string;
    displayName: string;
    role: OpsRole;
    tokenHash: string;
    expiresAt: string;
    createdAt: string;
    issuedByUserId: string;
  }) => Promise<boolean>;
  changeRole: (input: {
    actorUserId: string;
    targetUserId: string;
    role: OpsRole;
  }) => Promise<boolean>;
  lock: (input: { actorUserId: string; targetUserId: string; reason: string }) => Promise<boolean>;
  recover: (input: {
    actorUserId: string;
    targetUserId: string;
    tokenHash: string;
    expiresAt: string;
  }) => Promise<boolean>;
  revoke: (input: { actorUserId: string; targetUserId: string }) => Promise<boolean>;
};

type AuditLedger = {
  append: (input: {
    actorUserId: string | null;
    action: string;
    subjectType: string;
    subjectId?: string;
    metadata: Record<string, unknown>;
  }) => Promise<{ id: string; entryHash: string }>;
};

type Authorization = StepUpBinding;

export class AccountServiceError extends Error {
  constructor(
    readonly code:
      | 'ACCOUNT_SELF_PROTECTED'
      | 'ACCOUNT_FINAL_OWNER_PROTECTED'
      | 'ACCOUNT_NOT_FOUND'
      | 'ACCOUNT_NOT_OWNER'
      | 'ACCOUNT_USERNAME_CONFIRMATION_REQUIRED'
      | 'ACCOUNT_MUTATION_DENIED'
      | 'STEP_UP_REQUIRED'
  ) {
    super(code);
    this.name = 'AccountServiceError';
  }
}

function assertIdentifier(value: string, code: string): void {
  if (!value || value.trim() !== value || value.length < 1 || value.length > 320) {
    throw new Error(code);
  }
}

function enrollmentUrl(baseUrl: string, userId: string, token: string): string {
  const url = new URL('/bootstrap/mfa', baseUrl);
  url.hash = new URLSearchParams({ token, userId }).toString();
  return url.toString();
}

export class AccountService {
  private readonly now: () => Date;
  private readonly issueId: () => string;
  private readonly createToken: () => { plainToken: string; tokenHash: string };
  private readonly enrollmentBaseUrl: string;

  constructor(
    private readonly input: {
      repository: AccountRepository;
      stepUp: Pick<StepUpService, 'consume'>;
      audit: AuditLedger;
      now?: () => Date;
      issueId?: () => string;
      enrollmentToken?: () => { plainToken: string; tokenHash: string };
      enrollmentBaseUrl?: string;
    }
  ) {
    this.now = input.now ?? (() => new Date());
    this.issueId = input.issueId ?? randomUUID;
    this.createToken = input.enrollmentToken ?? issueEnrollmentToken;
    this.enrollmentBaseUrl = (input.enrollmentBaseUrl ?? 'https://ops.example.test').replace(
      /\/$/u,
      ''
    );
  }

  async list(): Promise<readonly OpsAccountSummary[]> {
    return this.input.repository.list();
  }

  async create(input: {
    actorUserId: string;
    username: string;
    email: string;
    displayName: string;
    role?: OpsRole;
    authorization: Authorization;
  }): Promise<{ userId: string; enrollmentUrl: string; expiresAt: string }> {
    await this.authorizeOwner(input.actorUserId, input.authorization);
    assertIdentifier(input.username, 'ACCOUNT_USERNAME_INVALID');
    assertIdentifier(input.email, 'ACCOUNT_EMAIL_INVALID');
    assertIdentifier(input.displayName, 'ACCOUNT_DISPLAY_NAME_INVALID');
    const role = input.role ?? 'ops_maintainer';
    const createdAt = this.now();
    const expiresAt = new Date(createdAt.getTime() + 24 * 60 * 60 * 1_000).toISOString();
    const token = this.createToken();
    const userId = this.issueId();
    const created = await this.input.repository.createPending({
      id: userId,
      username: input.username,
      email: input.email,
      displayName: input.displayName,
      role,
      tokenHash: token.tokenHash,
      expiresAt,
      createdAt: createdAt.toISOString(),
      issuedByUserId: input.actorUserId
    });
    if (!created) throw new AccountServiceError('ACCOUNT_MUTATION_DENIED');
    await this.audit(input.actorUserId, 'account.create', userId, {
      role,
      status: 'pending_mfa',
      expiresAt
    });
    return {
      userId,
      enrollmentUrl: enrollmentUrl(this.enrollmentBaseUrl, userId, token.plainToken),
      expiresAt
    };
  }

  async changeRole(input: {
    actorUserId: string;
    targetUserId: string;
    role: OpsRole;
    authorization: Authorization;
  }): Promise<void> {
    const target = await this.requireProtectedTarget(input.actorUserId, input.targetUserId);
    if (
      target.role === 'ops_owner' &&
      input.role !== 'ops_owner' &&
      (await this.input.repository.countActiveOwners()) <= 1
    ) {
      throw new AccountServiceError('ACCOUNT_FINAL_OWNER_PROTECTED');
    }
    await this.consume(input.authorization);
    if (!(await this.input.repository.changeRole(input)))
      throw new AccountServiceError('ACCOUNT_MUTATION_DENIED');
    await this.audit(input.actorUserId, 'account.role_changed', input.targetUserId, {
      role: input.role
    });
  }

  async lock(input: {
    actorUserId: string;
    targetUserId: string;
    reason?: string;
    authorization: Authorization;
  }): Promise<void> {
    const target = await this.requireProtectedTarget(input.actorUserId, input.targetUserId);
    if (target.role === 'ops_owner' && (await this.input.repository.countActiveOwners()) <= 1) {
      throw new AccountServiceError('ACCOUNT_FINAL_OWNER_PROTECTED');
    }
    await this.consume(input.authorization);
    const reason = input.reason?.trim() || 'OWNER_LOCK';
    if (
      !(await this.input.repository.lock({
        actorUserId: input.actorUserId,
        targetUserId: input.targetUserId,
        reason
      }))
    ) {
      throw new AccountServiceError('ACCOUNT_MUTATION_DENIED');
    }
    await this.audit(input.actorUserId, 'account.lock', input.targetUserId, { reason });
  }

  async recover(input: {
    actorUserId: string;
    targetUserId: string;
    authorization: Authorization;
  }): Promise<{ userId: string; enrollmentUrl: string; expiresAt: string }> {
    await this.authorizeOwner(input.actorUserId, input.authorization);
    const target = await this.input.repository.findById(input.targetUserId);
    if (!target) throw new AccountServiceError('ACCOUNT_NOT_FOUND');
    if (target.status !== 'locked') throw new AccountServiceError('ACCOUNT_MUTATION_DENIED');
    const expiresAt = new Date(this.now().getTime() + 24 * 60 * 60 * 1_000).toISOString();
    const token = this.createToken();
    if (
      !(await this.input.repository.recover({
        actorUserId: input.actorUserId,
        targetUserId: input.targetUserId,
        tokenHash: token.tokenHash,
        expiresAt
      }))
    )
      throw new AccountServiceError('ACCOUNT_MUTATION_DENIED');
    await this.audit(input.actorUserId, 'account.recovery_issued', input.targetUserId, {
      status: 'pending_mfa',
      expiresAt
    });
    return {
      userId: input.targetUserId,
      enrollmentUrl: enrollmentUrl(this.enrollmentBaseUrl, input.targetUserId, token.plainToken),
      expiresAt
    };
  }

  async revoke(input: {
    actorUserId: string;
    targetUserId: string;
    confirmationUsername: string;
    authorization: Authorization;
  }): Promise<void> {
    const target = await this.requireProtectedTarget(input.actorUserId, input.targetUserId);
    if (target.username !== input.confirmationUsername) {
      throw new Error('ACCOUNT_USERNAME_CONFIRMATION_REQUIRED');
    }
    if (target.role === 'ops_owner' && (await this.input.repository.countActiveOwners()) <= 1) {
      throw new AccountServiceError('ACCOUNT_FINAL_OWNER_PROTECTED');
    }
    await this.consume(input.authorization);
    if (!(await this.input.repository.revoke(input)))
      throw new AccountServiceError('ACCOUNT_MUTATION_DENIED');
    await this.audit(input.actorUserId, 'account.revoke', input.targetUserId, {
      status: 'revoked'
    });
  }

  private async authorizeOwner(actorUserId: string, authorization: Authorization): Promise<void> {
    const actor = await this.input.repository.findById(actorUserId);
    if (!actor || actor.status !== 'active' || actor.role !== 'ops_owner') {
      throw new AccountServiceError('ACCOUNT_NOT_OWNER');
    }
    await this.consume(authorization);
  }

  private async requireProtectedTarget(
    actorUserId: string,
    targetUserId: string
  ): Promise<OpsAccountSummary> {
    if (actorUserId === targetUserId) throw new AccountServiceError('ACCOUNT_SELF_PROTECTED');
    const target = await this.input.repository.findById(targetUserId);
    if (!target) throw new AccountServiceError('ACCOUNT_NOT_FOUND');
    return target;
  }

  private async consume(authorization: Authorization): Promise<void> {
    if (!(await this.input.stepUp.consume(authorization)))
      throw new AccountServiceError('STEP_UP_REQUIRED');
  }

  private async audit(
    actorUserId: string,
    action: string,
    subjectId: string,
    metadata: Record<string, unknown>
  ) {
    await this.input.audit.append({
      actorUserId,
      action,
      subjectType: 'ops_account',
      subjectId,
      metadata
    });
  }
}
