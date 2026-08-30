import { spawnSync } from 'node:child_process';

type Environment = Record<string, string | undefined>;
export type NotifySender = (message: string, socketPath: string) => void;

const normalizeSocketPath = (socketPath: string): string =>
  socketPath.startsWith('@') ? `\0${socketPath.slice(1)}` : socketPath;

function sendSystemdNotification(message: string, socketPath: string): void {
  const notifySocket = socketPath.startsWith('\0') ? `@${socketPath.slice(1)}` : socketPath;
  spawnSync('/usr/bin/systemd-notify', [message], {
    env: { ...process.env, NOTIFY_SOCKET: notifySocket },
    stdio: 'ignore'
  });
}

export function startSystemdWatchdog(
  env: Environment = process.env,
  sender: NotifySender = sendSystemdNotification
): { progress: () => void; stop: () => void } {
  const rawSocketPath = env.NOTIFY_SOCKET;
  if (!rawSocketPath) return { progress: () => undefined, stop: () => undefined };

  const socketPath = normalizeSocketPath(rawSocketPath);
  const safeSend = (message: string): void => {
    try {
      sender(message, socketPath);
    } catch {
      /* Notification failure must not stop collection. */
    }
  };
  safeSend('READY=1');

  const watchdogUsec = Number(env.WATCHDOG_USEC ?? '');
  if (!Number.isFinite(watchdogUsec) || watchdogUsec <= 0)
    return { progress: () => undefined, stop: () => undefined };

  let stopped = false;
  return {
    progress: () => {
      if (!stopped) safeSend('WATCHDOG=1');
    },
    stop: () => {
      stopped = true;
    }
  };
}
