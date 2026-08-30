import { mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { MonitorName, MonitorSample } from '../../shared/models.js';
import type { AppProbeConfig } from './healthProbe.js';
import { createOpsStore } from '../storage/store.js';
import { runCollectorCycle } from './collector.js';
import { createAuthService, provisionAccount } from '../security/auth.js';
import { createOpsApp } from '../http/app.js';

describe('collector cron and backup monitors', () => {
  it('removes a nested structured sentinel before SQLite persistence and authenticated API output', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'ops-redaction-pipeline-'));
    const now = new Date('2026-08-23T01:00:00.000Z');
    const sentinel = 'TOPSECRET-REVIEW-SENTINEL';
    const pidPath = join(directory, 'app.pid');
    const errorLogPath = join(directory, 'app-error.log');
    const cronLogPath = join(directory, 'cron.log');
    writeFileSync(pidPath, String(process.pid));
    writeFileSync(errorLogPath, `error={"context":{"route":"/login"},"api_key":"${sentinel}"}\n`);
    writeFileSync(cronLogPath, 'ops-cron job=nightly status=success\n');
    const store = createOpsStore(join(directory, 'ops.sqlite'), () => now);
    const errorCursorStat = statSync(errorLogPath);
    store.setCursor(errorLogPath, { inode: Number(errorCursorStat.ino), offset: 0 });
    try {
      await runCollectorCycle(
        {
          config: {
            nodeEnv: 'test',
            dbPath: join(directory, 'ops.sqlite'),
            appUrl: 'http://127.0.0.1:3000',
            postgresUrl: 'postgres://test',
            pm2PidPath: pidPath,
            pm2ErrorLogPath: errorLogPath,
            cronLogPath,
            backupDir: directory,
            zaloBotToken: 'test',
            recipientIds: [],
            zaloRecipientKey: Buffer.alloc(32),
            zaloTimeoutMs: 5000,
            beszel: { enabled: false }
          },
          store,
          histories: new Map(),
          appProbe: async (_config, kind, observedAt = now) => ({
            monitor: kind === 'liveness' ? 'app_liveness' : 'app_health',
            level: 'healthy',
            observedAt: observedAt.toISOString(),
            latencyMs: 1,
            details: { probeOk: true },
            errorCode: null
          }),
          postgresProbe: async (_config, observedAt = now) => ({
            monitor: 'postgres',
            level: 'healthy',
            observedAt: observedAt.toISOString(),
            latencyMs: 1,
            details: { probeOk: true },
            errorCode: null
          })
        },
        now
      );

      const database = store.getDatabaseForBackup();
      const persisted = database
        .prepare("SELECT details_json FROM monitor_samples WHERE monitor = 'errors'")
        .get() as { details_json: string };
      expect(persisted.details_json).not.toContain(sentinel);

      const dataKey = Buffer.alloc(32, 7);
      const provisioned = provisionAccount(
        store,
        {
          username: 'ops-redaction',
          password: 'correct horse battery staple',
          totpSeed: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
        },
        dataKey,
        now
      );
      const auth = createAuthService({ store, dataKey, now: () => now });
      const session = auth.createSession(provisioned.account);
      const response = await request(createOpsApp({ store, auth }))
        .get('/api/overview')
        .set('Cookie', `__Host-ops_session=${session.token}`)
        .expect(200);
      expect(JSON.stringify(response.body)).not.toContain(sentinel);
      expect(response.body.latestByMonitor.errors.details.safeExcerpt).toBe(
        'error=[payload redacted]'
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('records independent cron and backup levels from the deployed backup layout', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'ops-collector-'));
    const backupDirectory = join(directory, 'backups');
    const postgresDirectory = join(backupDirectory, 'postgres');
    mkdirSync(postgresDirectory, { recursive: true });
    const backupPath = join(postgresDirectory, 'edutrack-20260823.dump.age');
    writeFileSync(backupPath, 'encrypted');
    writeFileSync(`${backupPath}.sha256`, 'checksum');
    const cronLogPath = join(directory, 'cron.log');
    writeFileSync(cronLogPath, 'ops-cron job=nightly status=success\n');
    const pidPath = join(directory, 'app.pid');
    writeFileSync(pidPath, String(process.pid));
    const store = createOpsStore(join(directory, 'ops.sqlite'));
    const cursorStat = statSync(cronLogPath);
    store.setCursor(cronLogPath, { inode: Number(cursorStat.ino), offset: 0 });
    store.upsertIncident({
      dedupeKey: 'cron:backup_stale',
      monitor: 'cron',
      level: 'critical',
      state: 'open',
      recoveredAt: null,
      acknowledgedAt: null,
      acknowledgedBy: null,
      note: null,
      safeSummary: 'cron critical',
      now: '2026-08-23T00:00:00Z'
    });
    store.upsertIncident({
      dedupeKey: 'backup:backup_stale',
      monitor: 'backup',
      level: 'critical',
      state: 'open',
      recoveredAt: null,
      acknowledgedAt: null,
      acknowledgedBy: null,
      note: null,
      safeSummary: 'backup critical',
      now: '2026-08-23T00:00:00Z'
    });
    try {
      await runCollectorCycle(
        {
          config: {
            nodeEnv: 'test',
            dbPath: join(directory, 'ops.sqlite'),
            appUrl: 'http://127.0.0.1:3000',
            postgresUrl: 'postgres://test',
            pm2PidPath: pidPath,
            pm2ErrorLogPath: join(directory, 'app-error.log'),
            cronLogPath,
            backupDir: backupDirectory,
            zaloBotToken: 'test',
            recipientIds: [],
            zaloRecipientKey: Buffer.alloc(32),
            zaloTimeoutMs: 5000,
            beszel: { enabled: false }
          },
          store,
          histories: new Map(),
          appProbe: async (_config, kind, now = new Date()) => ({
            monitor: kind === 'liveness' ? 'app_liveness' : 'app_health',
            level: 'healthy',
            observedAt: now.toISOString(),
            latencyMs: 1,
            details: { probeOk: true },
            errorCode: null
          }),
          postgresProbe: async (_config, now = new Date()) => ({
            monitor: 'postgres',
            level: 'healthy',
            observedAt: now.toISOString(),
            latencyMs: 1,
            details: { probeOk: true },
            errorCode: null
          })
        },
        new Date('2026-08-23T01:00:00Z')
      );

      const latest = store.readDashboardOverview().latestByMonitor;
      expect(latest.cron).toMatchObject({ level: 'healthy', errorCode: null });
      expect(latest.backup).toMatchObject({ level: 'warning', errorCode: 'backup_local_only' });
      expect(store.readDashboardOverview().openIncidents).toEqual([
        expect.objectContaining({
          monitor: 'backup',
          dedupeKey: 'backup:backup_local_only',
          state: 'open'
        })
      ]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('runs Beszel at most once per minute and isolates a failed probe from legacy samples', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'ops-beszel-collector-'));
    const pidPath = join(directory, 'app.pid');
    const cronLogPath = join(directory, 'cron.log');
    writeFileSync(pidPath, String(process.pid));
    writeFileSync(cronLogPath, 'ops-cron job=nightly status=success\n');
    writeFileSync(join(directory, 'beszel-password'), 'fixture-password\n');
    const store = createOpsStore(join(directory, 'ops.sqlite'));
    const config = {
      nodeEnv: 'test',
      dbPath: join(directory, 'ops.sqlite'),
      appUrl: 'http://127.0.0.1:3000',
      postgresUrl: 'postgres://test',
      pm2PidPath: pidPath,
      pm2ErrorLogPath: join(directory, 'app-error.log'),
      cronLogPath,
      backupDir: directory,
      zaloBotToken: 'test',
      recipientIds: [],
      zaloRecipientKey: Buffer.alloc(32),
      zaloTimeoutMs: 5000,
      beszel: {
        enabled: true as const,
        baseUrl: 'http://127.0.0.1:8090' as const,
        username: 'ops-telemetry@thienuy.invalid',
        passwordFile: join(directory, 'beszel-password'),
        systemId: 'abc123def456ghi',
        timeoutMs: 5000
      }
    };
    const beszelProbe = vi.fn(
      async (now: Date): Promise<MonitorSample[]> => [
        {
          monitor: 'beszel',
          level: 'critical',
          observedAt: now.toISOString(),
          latencyMs: null,
          details: { probeOk: false },
          errorCode: 'beszel_timeout'
        }
      ]
    );
    const deps = {
      config,
      store,
      histories: new Map<MonitorName, MonitorSample[]>(),
      beszelProbe,
      appProbe: async (_config: AppProbeConfig, kind: 'liveness' | 'health', now: Date) => ({
        monitor: kind === 'liveness' ? ('app_liveness' as const) : ('app_health' as const),
        level: 'healthy' as const,
        observedAt: now.toISOString(),
        latencyMs: 1,
        details: { probeOk: true },
        errorCode: null
      }),
      postgresProbe: async (_config: { postgresUrl: string }, now = new Date()) => ({
        monitor: 'postgres' as const,
        level: 'healthy' as const,
        observedAt: now.toISOString(),
        latencyMs: 1,
        details: { probeOk: true },
        errorCode: null
      })
    };
    try {
      for (const second of [0, 15, 59, 60])
        await runCollectorCycle(deps, new Date(Date.parse('2026-08-23T00:01:00Z') + second * 1000));
      expect(beszelProbe).toHaveBeenCalledTimes(2);
      const db = store.getDatabaseForBackup();
      expect(
        (
          db
            .prepare("SELECT COUNT(*) as count FROM monitor_samples WHERE monitor = 'beszel'")
            .get() as { count: number }
        ).count
      ).toBe(2);
      expect(store.readDashboardOverview().latestByMonitor.app_liveness?.level).toBe('healthy');
      expect(store.readDashboardOverview().latestByMonitor.postgres?.level).toBe('healthy');
      expect(store.readDashboardOverview().latestByMonitor.cron?.level).toBe('healthy');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('persists the evaluated infrastructure level while retaining raw healthy history', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'ops-beszel-effective-'));
    const pidPath = join(directory, 'app.pid');
    const cronLogPath = join(directory, 'cron.log');
    writeFileSync(pidPath, String(process.pid));
    writeFileSync(cronLogPath, '');
    writeFileSync(join(directory, 'beszel-password'), 'fixture-password\n');
    const store = createOpsStore(join(directory, 'ops.sqlite'));
    const history = Array.from(
      { length: 10 },
      (_, index): MonitorSample => ({
        monitor: 'host_resources',
        level: 'healthy',
        observedAt: `2026-08-23T00:0${index}:00.000Z`,
        latencyMs: null,
        details: {
          cpuPercent: 95,
          memoryPercent: 10,
          diskPercent: 10,
          load5: 0.1,
          cpuThreads: 4,
          conditionHealthy: false
        },
        errorCode: null
      })
    );
    const deps = {
      config: {
        nodeEnv: 'test',
        dbPath: join(directory, 'ops.sqlite'),
        appUrl: 'http://127.0.0.1:3000',
        postgresUrl: 'postgres://test',
        pm2PidPath: pidPath,
        pm2ErrorLogPath: join(directory, 'app-error.log'),
        cronLogPath,
        backupDir: directory,
        zaloBotToken: 'test',
        recipientIds: [],
        zaloRecipientKey: Buffer.alloc(32),
        zaloTimeoutMs: 5000,
        beszel: {
          enabled: true as const,
          baseUrl: 'http://127.0.0.1:8090' as const,
          username: 'ops-telemetry@thienuy.invalid',
          passwordFile: join(directory, 'beszel-password'),
          systemId: 'abc123def456ghi',
          timeoutMs: 5000
        }
      },
      store,
      histories: new Map<MonitorName, MonitorSample[]>([['host_resources', history]]),
      beszelProbe: async (now: Date): Promise<MonitorSample[]> => [
        {
          monitor: 'host_resources',
          level: 'healthy',
          observedAt: now.toISOString(),
          latencyMs: null,
          details: {
            cpuPercent: 95,
            memoryPercent: 10,
            diskPercent: 10,
            load5: 0.1,
            cpuThreads: 4,
            conditionHealthy: false
          },
          errorCode: null
        }
      ],
      appProbe: async (_config: AppProbeConfig, kind: 'liveness' | 'health', now: Date) => ({
        monitor: kind === 'liveness' ? ('app_liveness' as const) : ('app_health' as const),
        level: 'healthy' as const,
        observedAt: now.toISOString(),
        latencyMs: 1,
        details: { probeOk: true },
        errorCode: null
      }),
      postgresProbe: async (_config: { postgresUrl: string }, now = new Date()) => ({
        monitor: 'postgres' as const,
        level: 'healthy' as const,
        observedAt: now.toISOString(),
        latencyMs: 1,
        details: { probeOk: true },
        errorCode: null
      })
    };
    try {
      await runCollectorCycle(deps, new Date('2026-08-23T00:10:00.000Z'));
      expect(store.readDashboardOverview().latestByMonitor.host_resources?.level).toBe('critical');
      expect(deps.histories.get('host_resources')?.at(-1)?.level).toBe('healthy');
      expect(deps.histories.get('host_resources')?.at(-1)?.details.effectiveLevel).toBe('critical');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
