import { randomBytes } from 'node:crypto';
import { getPostgresPool } from '@/server/db/client.js';
import type { App } from '@/server/db/documentStore.js';
import {
  createStaffIdentity,
  revokeStaffIdentity,
  setStaffPassword,
} from './sessionStore.js';

export type UserRecord = {
  uid: string;
  email?: string;
  displayName?: string;
  disabled: boolean;
  metadata: { creationTime: string };
};

export type CreateRequest = {
  uid?: string;
  email?: string;
  password?: string;
  displayName?: string;
  role?: 'teacher' | 'accounting' | 'office' | 'admin';
};

type UserRow = {
  id: string;
  email: string | null;
  display_name: string;
  is_revoked: boolean;
  created_at: Date;
};

function toUserRecord(row: UserRow): UserRecord {
  return {
    uid: row.id,
    email: row.email || undefined,
    displayName: row.display_name || undefined,
    disabled: row.is_revoked,
    metadata: { creationTime: row.created_at.toISOString() },
  };
}

function authError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

export class Auth {
  async getUser(uid: string): Promise<UserRecord> {
    const result = await getPostgresPool().query<UserRow>(
      `select id, email, display_name, is_revoked, created_at from users where id = $1`,
      [uid]
    );
    if (!result.rows[0]) throw authError('auth/user-not-found', `User not found: ${uid}`);
    return toUserRecord(result.rows[0]);
  }

  async getUserByEmail(email: string): Promise<UserRecord> {
    const result = await getPostgresPool().query<UserRow>(
      `select id, email, display_name, is_revoked, created_at
         from users where lower(email) = $1 limit 1`,
      [email.trim().toLowerCase()]
    );
    if (!result.rows[0]) throw authError('auth/user-not-found', `User not found: ${email}`);
    return toUserRecord(result.rows[0]);
  }

  async listUsers(maxResults = 1000, pageToken?: string): Promise<{
    users: UserRecord[];
    pageToken?: string;
  }> {
    const limit = Math.min(1000, Math.max(1, Math.floor(maxResults)));
    const offset = Math.max(0, Number.parseInt(pageToken || '0', 10) || 0);
    const result = await getPostgresPool().query<UserRow>(
      `select id, email, display_name, is_revoked, created_at
         from users order by id limit $1 offset $2`,
      [limit + 1, offset]
    );
    const hasNext = result.rows.length > limit;
    return {
      users: result.rows.slice(0, limit).map(toUserRecord),
      pageToken: hasNext ? String(offset + limit) : undefined,
    };
  }

  async createUser(input: CreateRequest): Promise<UserRecord> {
    if (!input.email) throw authError('auth/invalid-email', 'Email is required');
    if (input.uid) {
      const existing = await getPostgresPool().query('select 1 from users where id = $1', [input.uid]);
      if (existing.rowCount) throw authError('auth/uid-already-exists', 'UID already exists');
    }
    const password = input.password || randomBytes(24).toString('base64url');
    try {
      const created = await createStaffIdentity({
        email: input.email,
        displayName: input.displayName || input.email.split('@')[0],
        role: input.role || 'teacher',
        password,
        forcePasswordChange: Boolean(input.password),
      });
      return this.getUser(created.uid);
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw authError('auth/email-already-exists', 'Email already exists');
      }
      throw error;
    }
  }

  async updateUser(
    uid: string,
    input: { password?: string; displayName?: string; disabled?: boolean }
  ): Promise<UserRecord> {
    if (input.password) await setStaffPassword(uid, input.password);
    await getPostgresPool().query(
      `update users
          set display_name = coalesce($2, display_name),
              is_revoked = coalesce($3, is_revoked),
              updated_at = now()
        where id = $1`,
      [uid, input.displayName || null, input.disabled ?? null]
    );
    return this.getUser(uid);
  }

  async deleteUser(uid: string): Promise<void> {
    await revokeStaffIdentity(uid);
  }
}

const nativeAuth = new Auth();

export function getAuth(_app?: App): Auth {
  return nativeAuth;
}
