import crypto from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPostgresPool } from '@/server/db/client.js';
import { getDocumentStore } from '@/server/db/documentStore.js';
import {
  createStaffIdentity,
  findStaffUserIdByEmail,
  revokeStaffIdentitiesByEmail,
  setStaffForcePasswordChange,
  setStaffPassword,
} from '@/server/api/lib/auth/sessionStore.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadLocalEnv() {
  const envPath = path.join(projectRoot, '.env');
  if (!existsSync(envPath)) return;

  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed
      .slice(separator + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '');
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function generateRandomPassword(length = 14): string {
  const charset = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$';
  const bytes = crypto.randomBytes(length);
  return Array.from(bytes, (byte) => charset[byte % charset.length]).join('');
}

function parseArgs() {
  const args = process.argv.slice(2);
  const action = args[0];
  const options: Record<string, string> = {};
  for (const arg of args.slice(1)) {
    if (!arg.startsWith('--')) continue;
    const separator = arg.indexOf('=');
    if (separator < 3) continue;
    options[arg.slice(2, separator)] = arg
      .slice(separator + 1)
      .replace(/^['"]|['"]$/g, '');
  }
  return { action, options };
}

async function activateExistingAdmin(input: {
  uid: string;
  email: string;
  displayName: string;
  phone: string;
  password: string;
}) {
  const pool = getPostgresPool();
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(
      `update users
          set display_name = $2,
              role = 'admin',
              phone = nullif($3, ''),
              force_password_change = true,
              is_revoked = false,
              updated_at = now()
        where id = $1`,
      [input.uid, input.displayName, input.phone]
    );
    await client.query(
      `insert into staff_email_access (email, status, role, added_at, added_by_admin)
       values ($1, 'allowed', 'admin', now(), true)
       on conflict (email) do update
         set status = 'allowed', role = 'admin', blocked_at = null,
             blocked_by = null, updated_at = now()`,
      [input.email]
    );
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
  await setStaffPassword(input.uid, input.password);
  await setStaffForcePasswordChange(input.uid, true);
}

async function main() {
  loadLocalEnv();
  const { action, options } = parseArgs();
  if (!action || !['create', 'delete'].includes(action)) {
    console.error('Usage:');
    console.error(
      '  npx tsx scripts/manage-admin.ts create --email=<email> --name="<name>" [--phone=<phone>]'
    );
    console.error('  npx tsx scripts/manage-admin.ts delete --email=<email>');
    process.exitCode = 1;
    return;
  }

  const email = options.email?.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error('Error: A valid --email=<email> option is required.');
    process.exitCode = 1;
    return;
  }

  const db = getDocumentStore();
  if (action === 'create') {
    const displayName = options.name?.trim() || email.split('@')[0];
    const phone = options.phone?.trim() || '';
    const tempPassword = generateRandomPassword();
    try {
      let uid = await findStaffUserIdByEmail(email);
      if (uid) {
        await activateExistingAdmin({ uid, email, displayName, phone, password: tempPassword });
      } else {
        const created = await createStaffIdentity({
          email,
          displayName,
          role: 'admin',
          password: tempPassword,
          phone: phone || undefined,
          forcePasswordChange: true,
        });
        uid = created.uid;
      }

      const now = new Date().toISOString();
      await db.collection('allowed_teachers').doc(email).set(
        { email, role: 'admin', addedAt: now, addedByAdmin: true },
        { merge: true }
      );
      await db.collection('blocked_teachers').doc(email).delete();
      await db.collection('users').doc(uid).set(
        {
          uid,
          email,
          displayName,
          role: 'admin',
          blockedTeacher: false,
          forcePasswordChange: true,
          isRevoked: false,
          updatedAt: now,
          ...(phone ? { phone } : {}),
        },
        { merge: true }
      );

      console.log('Administrator account configured successfully.');
      console.log(`Email: ${email}`);
      console.log(`Password: ${tempPassword}`);
      console.log('The administrator must change this temporary password on first login.');
    } catch (error) {
      console.error('Failed to configure administrator account:', error);
      process.exitCode = 1;
    }
    return;
  }

  try {
    const uid = await findStaffUserIdByEmail(email);
    const revoked = await revokeStaffIdentitiesByEmail(email);
    await db.collection('allowed_teachers').doc(email).delete();
    await db.collection('blocked_teachers').doc(email).set(
      { email, blockedAt: new Date().toISOString(), blockedByAdmin: true },
      { merge: true }
    );
    if (uid) {
      await db.collection('users').doc(uid).set(
        { isRevoked: true, blockedTeacher: true, updatedAt: new Date().toISOString() },
        { merge: true }
      );
    }
    console.log(`Administrator access revoked for ${email} (${revoked} account(s)).`);
  } catch (error) {
    console.error('Failed to revoke administrator account:', error);
    process.exitCode = 1;
  }
}

if (process.env.VITEST !== 'true' && process.env.NODE_ENV !== 'test') {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
