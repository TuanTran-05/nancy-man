import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cert, getApps, initializeApp } from '@/server/db/documentStore.js';
import { getDocumentStore, type DocumentStore } from '@/server/db/documentStore.js';
import {
  buildSnapshotSendPlan,
  verifySnapshot,
  type OfficeAcademicZaloSnapshot,
  type SnapshotExpectations,
  type SnapshotMessageType,
  type SnapshotSendPlanRow,
} from './office-academic-zalo-snapshot.js';

type SendResult = { success: boolean; messageId?: string; error?: string };
type AuditLog = Record<string, unknown>;

export type SnapshotExecutionResult = {
  mode: 'dry-run' | 'apply';
  checksum: string;
  planned: { evaluation: number; rank: number; tuition: number; total: number };
  completed: { sent: number; failed: number; skipped: number };
  results: Array<{
    studentCode: string;
    type: SnapshotMessageType;
    status: 'planned' | 'sent' | 'failed' | 'skipped_evaluation_not_sent';
    error?: string;
  }>;
};

export async function executeSnapshotSend(input: {
  snapshot: OfficeAcademicZaloSnapshot;
  expectations: SnapshotExpectations;
  apply: boolean;
  sendMessage: (row: SnapshotSendPlanRow) => Promise<SendResult>;
  writeLog: (log: AuditLog) => Promise<void>;
  sleepMs: number;
}): Promise<SnapshotExecutionResult> {
  const counts = verifySnapshot(input.snapshot, input.expectations);
  const plan = buildSnapshotSendPlan(input.snapshot);
  const planned = {
    evaluation: counts.evaluationCount,
    rank: counts.rankCount,
    tuition: counts.tuitionCount,
    total: plan.length,
  };
  if (!input.apply) {
    return {
      mode: 'dry-run',
      checksum: input.snapshot.checksum,
      planned,
      completed: { sent: 0, failed: 0, skipped: 0 },
      results: plan.map((row) => ({ studentCode: row.studentCode, type: row.type, status: 'planned' })),
    };
  }

  const results: SnapshotExecutionResult['results'] = [];
  const failedEvaluations = new Set<string>();
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  for (const row of plan) {
    if (row.type !== 'evaluation_notice' && failedEvaluations.has(row.studentDocId)) {
      skipped += 1;
      results.push({
        studentCode: row.studentCode,
        type: row.type,
        status: 'skipped_evaluation_not_sent',
      });
      continue;
    }
    const response = await input.sendMessage(row);
    const status = response.success ? 'sent' : 'failed';
    if (response.success) sent += 1;
    else {
      failed += 1;
      if (row.type === 'evaluation_notice') failedEvaluations.add(row.studentDocId);
    }
    await input.writeLog({
      studentId: row.studentDocId,
      studentName: row.studentName,
      studentCode: row.studentCode,
      classId: row.classId,
      className: row.className,
      phone: row.phone,
      status,
      zaloMessageId: response.messageId || '',
      errorMessage: response.error || '',
      type: row.type,
      source: 'scheduled_snapshot_resend',
      resendBy: row.resendBy,
      snapshotChecksum: input.snapshot.checksum,
      createdAt: new Date().toISOString(),
    });
    results.push({ studentCode: row.studentCode, type: row.type, status, ...(response.error ? { error: response.error } : {}) });
    if (input.sleepMs > 0) await new Promise((resolve) => setTimeout(resolve, input.sleepMs));
  }
  return {
    mode: 'apply',
    checksum: input.snapshot.checksum,
    planned,
    completed: { sent, failed, skipped },
    results,
  };
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

function getArg(name: string): string | undefined {
  const prefix = `${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length).replace(/^"|"$/g, '');
}

function requiredArg(name: string): string {
  const value = getArg(name);
  if (!value) throw new Error(`Missing required argument ${name}`);
  return value;
}

function requiredNumberArg(name: string): number {
  const value = Number(requiredArg(name));
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`);
  return value;
}

function loadDotEnv(): void {
  for (const envPath of [path.join(projectRoot, '.env'), path.join(projectRoot, '.vercel/.env.preview.local')]) {
    if (!existsSync(envPath)) continue;
    for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match || process.env[match[1]]) continue;
      let value = match[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      process.env[match[1]] = value.replace(/\\n/g, '\n');
    }
  }
}

function initDb(): DocumentStore {
  loadDotEnv();
  if (getApps().length === 0) {
    const servicePath = path.join(projectRoot, 'service-account-key.json');
    if (existsSync(servicePath)) initializeApp({ credential: cert(JSON.parse(readFileSync(servicePath, 'utf8'))) });
    else initializeApp({ credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }) });
  }
  const configPath = path.join(projectRoot, 'firebase-applet-config.json');
  const config = existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf8')) : {};
  const databaseId = process.env.FIRESTORE_DATABASE_ID || config.documentStoreDatabaseId;
  return databaseId ? getDocumentStore(getApps()[0], databaseId) : getDocumentStore(getApps()[0]);
}

async function readTokenState(db: DocumentStore) {
  const snap = await db.collection('_zalo_config').doc('tokens').get();
  const data = snap.exists ? snap.data() || {} : {};
  return {
    accessToken: String(data.accessToken || process.env.ZALO_OA_ACCESS_TOKEN || ''),
    refreshToken: String(data.refreshToken || process.env.ZALO_REFRESH_TOKEN || ''),
  };
}

async function refreshAccessToken(db: DocumentStore, refreshToken: string): Promise<string | null> {
  const appId = process.env.ZALO_APP_ID || '';
  const appSecret = process.env.ZALO_APP_SECRET || '';
  if (!refreshToken || !appId || !appSecret) return null;
  const response = await fetch('https://oauth.zaloapp.com/v4/oa/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', secret_key: appSecret },
    body: new URLSearchParams({ refresh_token: refreshToken, app_id: appId, grant_type: 'refresh_token' }).toString(),
  });
  const data = await response.json();
  if (!data?.access_token) return null;
  await db.collection('_zalo_config').doc('tokens').set({
    accessToken: String(data.access_token),
    refreshToken: String(data.refresh_token || refreshToken),
    expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000,
    updatedAt: new Date().toISOString(),
  }, { merge: true });
  return String(data.access_token);
}

function templateIdFor(type: SnapshotMessageType): string {
  if (type === 'evaluation_notice') return process.env.ZALO_ZNS_EVAL_TEMPLATE_ID || '';
  if (type === 'rank_achievement') return process.env.ZALO_ZNS_RANK_TEMPLATE_ID || '';
  return process.env.ZALO_ZNS_NEXT_COURSE_TUITION_TEMPLATE_ID || '';
}

async function sendZns(accessToken: string, row: SnapshotSendPlanRow): Promise<SendResult> {
  const templateId = templateIdFor(row.type);
  const response = await fetch('https://business.openapi.zalo.me/message/template', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', access_token: accessToken },
    body: JSON.stringify({
      phone: row.phone,
      template_id: templateId,
      template_data: row.templateData,
      tracking_id: `edutrack_snapshot_${row.studentCode}_${Date.now()}`.substring(0, 48),
    }),
  });
  const data = await response.json();
  if (data.error === 0 || data.message === 'Success') return { success: true, messageId: data.data?.msg_id || String(Date.now()) };
  return { success: false, error: `Zalo error ${data.error ?? 'unknown'}: ${data.message || ''}`.trim() };
}

async function main(): Promise<void> {
  const snapshotPath = path.resolve(projectRoot, requiredArg('--snapshot'));
  const expectedChecksum = requiredArg('--expected-checksum');
  const expectedTargetCount = requiredNumberArg('--expected-target-count');
  const expectedRankCount = requiredNumberArg('--expected-rank-count');
  const expectedTuition = requiredNumberArg('--expected-tuition');
  const apply = process.argv.includes('--apply');
  if (apply && !process.argv.includes('--yes')) throw new Error('Refusing apply without --yes');
  const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8')) as OfficeAcademicZaloSnapshot;
  if (snapshot.checksum !== expectedChecksum) throw new Error('Expected checksum does not match snapshot');
  const expectations = {
    classId: 'MbEjkY4bZPvUt9ykRpPu',
    tuitionAmount: expectedTuition,
    evaluationCount: expectedTargetCount,
    rankCount: expectedRankCount,
    tuitionCount: expectedTargetCount,
  };

  let db: DocumentStore | null = null;
  let accessToken = '';
  if (apply) {
    db = initDb();
    for (const type of ['evaluation_notice', 'rank_achievement', 'tuition_notice'] as const) {
      if (!templateIdFor(type)) throw new Error(`Missing Zalo template ID for ${type}`);
    }
    const state = await readTokenState(db);
    accessToken = (await refreshAccessToken(db, state.refreshToken)) || '';
    if (!accessToken) throw new Error('Unable to refresh Zalo access token; aborting before sending');
  }
  const result = await executeSnapshotSend({
    snapshot,
    expectations,
    apply,
    sleepMs: Number(getArg('--sleep-ms') || 900),
    sendMessage: (row) => sendZns(accessToken, row),
    writeLog: async (log) => {
      if (!db) throw new Error('DocumentStore is unavailable');
      await db.collection('zalo_notifications').add({ ...log, templateId: templateIdFor(log.type as SnapshotMessageType) });
    },
  });
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
