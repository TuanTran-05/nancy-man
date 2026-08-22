import { createServer } from 'node:http';
import { realpathSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { validateEnv } from './api/lib/validation/validateEnv.js';
import { closeSqlDb, readPostgresConfig } from './db/client.js';
import { createApp } from './http/app.js';
import { drainBackgroundTasks } from './runtime/backgroundTasks.js';

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function validateVpsEnvironment() {
  if (process.env.NODE_ENV !== 'production') {
    throw new Error('NODE_ENV must be production on the VPS');
  }
  required('APP_URL');
  required('PUBLIC_BASE_URL');
  required('CRON_SECRET');
  readPostgresConfig();
  validateEnv();
}

export function startServer() {
  validateVpsEnvironment();
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT: ${process.env.PORT}`);
  }
  const host = process.env.HOST?.trim() || '127.0.0.1';
  const server = createServer(createApp());

  server.listen(port, host, () => {
    console.log(`[http] listening on http://${host}:${port}`);
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[http] ${signal}, shutting down`);
    const forceTimer = setTimeout(() => {
      console.error('[http] graceful shutdown timed out; closing active connections');
      server.closeAllConnections();
      process.exitCode = 1;
    }, 10_000);
    forceTimer.unref();

    try {
      server.closeIdleConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      const drained = await drainBackgroundTasks(8_000);
      if (!drained) {
        console.error('[http] background tasks did not finish before shutdown');
        process.exitCode = 1;
      }
      await closeSqlDb();
      console.log('[http] shutdown complete');
    } catch (error) {
      console.error('[http] graceful shutdown failed', error);
      process.exitCode = 1;
    } finally {
      clearTimeout(forceTimer);
    }
  };
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));

  return server;
}

export function isServerEntrypoint(
  moduleUrl: string,
  argvPath = process.argv[1],
  pmExecPath = process.env.pm_exec_path,
  canonicalizePath: (filePath: string) => string = realpathSync
) {
  const entrypointPath = pmExecPath?.trim() || argvPath;
  if (!entrypointPath) return false;
  if (moduleUrl === pathToFileURL(entrypointPath).href) return true;

  try {
    return moduleUrl === pathToFileURL(canonicalizePath(entrypointPath)).href;
  } catch {
    return false;
  }
}

if (isServerEntrypoint(import.meta.url)) {
  startServer();
}
