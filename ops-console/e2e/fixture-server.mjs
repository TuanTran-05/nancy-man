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
db.prepare('INSERT INTO incidents (id, dedupe_key, monitor, level, state, occurrence_count, opened_at, last_seen_at, recovered_at, acknowledged_at, acknowledged_by, note, safe_summary) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run('e2e-incident', 'app_liveness:e2e', 'app_liveness', 'warning', 'open', 1, new Date().toISOString(), new Date().toISOString(), null, null, null, null, 'Synthetic E2E incident');
db.close();

const close = () => { server.close(() => { rmSync(directory, { recursive: true, force: true }); process.exit(0); }); };
process.once('SIGTERM', close);
process.once('SIGINT', close);
process.stdin.resume();
