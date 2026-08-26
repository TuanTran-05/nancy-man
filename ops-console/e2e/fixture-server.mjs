import { createCipheriv, randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';

const port = Number(process.env.OPS_E2E_BASE_URL?.split(':').pop() ?? '3101');
const directory = mkdtempSync(join(tmpdir(), 'edutrack-ops-e2e-'));
const dbPath = join(directory, 'ops.sqlite');
const dataKey = Buffer.alloc(32, 7);
const seed = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const password = process.env.OPS_E2E_PASSWORD ?? 'correct horse battery staple';
process.env.NODE_ENV = 'test';
process.env.OPS_DB_PATH = dbPath;
process.env.OPS_DATA_KEY = dataKey.toString('base64');
process.env.OPS_LISTEN_HOST = '127.0.0.1';
process.env.OPS_PORT = String(port);
process.env.OPS_ALERT_ZALO_BOT_TOKEN = 'e2e-bot-token';
process.env.OPS_ZALO_WEBHOOK_SECRET = 'e'.repeat(32);
process.env.OPS_ZALO_LINK_CODE_PEPPER = 'p'.repeat(32);
process.env.OPS_ZALO_CHAT_HASH_SECRET = 'h'.repeat(32);
process.env.OPS_ZALO_RECIPIENT_KEY = Buffer.alloc(32, 8).toString('base64');
process.env.OPS_ALERT_ZALO_TIMEOUT_MS = '5000';
process.env.OPS_ZALO_LINK_TTL_SECONDS = '600';

const passwordSalt = randomBytes(16);
const passwordKey = scryptSync(password, passwordSalt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
const passwordHash = `scrypt$v=1$N=16384$r=8$p=1$salt=${passwordSalt.toString('base64url')}$hash=${passwordKey.toString('base64url')}`;
const iv = randomBytes(12);
const cipher = createCipheriv('aes-256-gcm', dataKey, iv);
const encrypted = Buffer.concat([cipher.update(seed, 'utf8'), cipher.final()]);
const encryptedSeed = `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`;

const { startWebServer } = await import('../dist/server/web-server.js');
const server = startWebServer();
const db = new Database(dbPath);
const accountId = randomUUID();
db.prepare('INSERT INTO accounts (id, username, password_hash, totp_secret_enc, created_at, disabled_at) VALUES (?, ?, ?, ?, ?, NULL)').run(accountId, 'ops-e2e', passwordHash, encryptedSeed, new Date().toISOString());
db.prepare('INSERT INTO monitor_samples (monitor, level, observed_at, latency_ms, details_json, error_code) VALUES (?, ?, ?, ?, ?, ?)').run('app_liveness', 'healthy', new Date().toISOString(), 4, JSON.stringify({ probeOk: true, release: 'e2e' }), null);
const telemetryObservedAt = new Date().toISOString();
const resourceDetails = { cpuPercent: 42.5, memoryPercent: 61.2, memoryUsedBytes: 6442450944, memoryTotalBytes: 10737418240, swapPercent: 0, swapUsedBytes: 0, swapTotalBytes: 2147483648, diskPercent: 48, diskUsedBytes: 51539607552, diskTotalBytes: 107374182400, networkReceiveBytesPerSecond: 1200, networkTransmitBytesPerSecond: 800, diskReadBytesPerSecond: 600, diskWriteBytesPerSecond: 300, load1: 1.2, load5: 0.9, load15: 0.7, cpuThreads: 4, probeOk: true, metricObservedAt: telemetryObservedAt };
const serviceDetails = { matchedTotal: 2, failedServices: ['edutrack-worker'], services: [
  { name: 'edutrack-worker', state: 'failed', subState: 'failed', cpuPercent: 0.1, memoryBytes: 16777216, observedAt: telemetryObservedAt },
  { name: 'postgresql', state: 'active', subState: 'running', cpuPercent: 2, memoryBytes: 1048576, observedAt: telemetryObservedAt },
] };
db.prepare('INSERT INTO monitor_samples (monitor, level, observed_at, latency_ms, details_json, error_code) VALUES (?, ?, ?, ?, ?, ?)').run('beszel', 'healthy', telemetryObservedAt, 4, JSON.stringify({ probeOk: true, hubVersion: '0.18.8', agentVersion: '0.18.8', systemStatus: 'up', metricObservedAt: telemetryObservedAt }), null);
db.prepare('INSERT INTO monitor_samples (monitor, level, observed_at, latency_ms, details_json, error_code) VALUES (?, ?, ?, ?, ?, ?)').run('host_resources', 'healthy', telemetryObservedAt, 8, JSON.stringify(resourceDetails), null);
db.prepare('INSERT INTO monitor_samples (monitor, level, observed_at, latency_ms, details_json, error_code) VALUES (?, ?, ?, ?, ?, ?)').run('host_services', 'critical', telemetryObservedAt, 8, JSON.stringify(serviceDetails), 'service_failed');
for (const minutesAgo of [5, 10, 15]) {
  const observedAt = new Date(Date.now() - minutesAgo * 60_000).toISOString();
  db.prepare('INSERT INTO monitor_samples (monitor, level, observed_at, latency_ms, details_json, error_code) VALUES (?, ?, ?, ?, ?, ?)').run('host_resources', 'healthy', observedAt, 8, JSON.stringify({ ...resourceDetails, cpuPercent: 40 + minutesAgo / 10, metricObservedAt: observedAt }), null);
}
db.prepare('INSERT INTO incidents (id, dedupe_key, monitor, level, state, occurrence_count, opened_at, last_seen_at, recovered_at, acknowledged_at, acknowledged_by, note, safe_summary) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run('e2e-incident', 'app_liveness:e2e', 'app_liveness', 'warning', 'open', 1, new Date().toISOString(), new Date().toISOString(), null, null, null, null, 'Synthetic E2E incident');
db.close();

const close = () => { server.close(() => { rmSync(directory, { recursive: true, force: true }); process.exit(0); }); };
process.once('SIGTERM', close);
process.once('SIGINT', close);
process.stdin.resume();
