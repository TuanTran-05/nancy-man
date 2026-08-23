import { readFileSync, statSync } from 'node:fs';
import type { MonitorSample } from '../../shared/models.js';

export interface ProcessProbeConfig {
  pidFile: string;
  procRoot?: string;
}

export function probeAppProcess(config: ProcessProbeConfig, now: Date = new Date()): MonitorSample {
  const observedAt = now.toISOString();
  try {
    const pidRaw = readFileSync(config.pidFile, 'utf8').trim();
    if (!/^\d{1,10}$/u.test(pidRaw)) throw new Error('invalid pid');
    const pid = Number(pidRaw);
    if (!Number.isSafeInteger(pid) || pid <= 1) throw new Error('invalid pid');
    const procRoot = config.procRoot ?? '/proc';
    const statPath = `${procRoot}/${pid}/stat`;
    const statusPath = `${procRoot}/${pid}/status`;
    const stat = readFileSync(statPath, 'utf8');
    const status = readFileSync(statusPath, 'utf8');
    const closeParen = stat.lastIndexOf(')');
    const fields = closeParen >= 0 ? stat.slice(closeParen + 2).split(' ') : [];
    const state = fields[0];
    if (!state || state === 'Z') throw new Error('process is not running');
    const rssMatch = status.match(/^VmRSS:\s+(\d+)\s+kB$/mu);
    const nameMatch = status.match(/^Name:\s+([^\n]+)$/mu);
    const statInfo = statSync(statPath);
    const startTicks = Number(fields[19]);
    let uptimeSeconds: number | null = null;
    try {
      const systemUptime = Number.parseFloat(readFileSync(`${procRoot}/uptime`, 'utf8').split(/\s+/u)[0]);
      if (Number.isFinite(startTicks) && Number.isFinite(systemUptime)) uptimeSeconds = Math.max(0, systemUptime - startTicks / 100);
    } catch { uptimeSeconds = null; }
    return {
      monitor: 'app_process',
      level: 'healthy',
      observedAt,
      latencyMs: 0,
      details: {
        probeOk: true,
        pid,
        state,
        memoryBytes: rssMatch ? Number(rssMatch[1]) * 1024 : null,
        uptimeSeconds,
        processName: nameMatch && /^[A-Za-z0-9._-]{1,100}$/.test(nameMatch[1].trim()) ? nameMatch[1].trim() : null,
        startedAt: statInfo.ctime.toISOString(),
      },
      errorCode: null,
    };
  } catch {
    return { monitor: 'app_process', level: 'critical', observedAt, latencyMs: 0, details: { probeOk: false }, errorCode: 'process_unavailable' };
  }
}
