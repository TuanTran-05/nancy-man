import { describe, expect, test } from 'vitest';

import {
  createActionRunner,
  ActionRunnerError,
  type FixedActionDefinition,
  type ProcessExecutor
} from './actionRunner.js';

const definitions: readonly FixedActionDefinition[] = [
  {
    id: 'pm2.reload_app',
    strategy: 'runtime_restart',
    executable: '/usr/bin/pm2',
    args: ['reload', 'edutrack'],
    timeoutMs: 2_000,
    maxOutputBytes: 128,
    environment: { PATH: '/usr/bin:/bin', LANG: 'C' }
  },
  {
    id: 'job.next_run',
    strategy: 'next_job',
    executable: null,
    args: [],
    timeoutMs: 1_000,
    maxOutputBytes: 128,
    environment: {}
  }
];

describe('fixed config-agent action runner', () => {
  test('executes only manifest-resolved argv with shell disabled and minimal environment', async () => {
    const calls: unknown[] = [];
    const executor: ProcessExecutor = async (spec) => {
      calls.push(spec);
      return { exitCode: 0, signal: null, stdoutBytes: 0, stderrBytes: 0, timedOut: false };
    };
    const runner = createActionRunner({ definitions, executor });

    const result = await runner.run({ runId: 'RUN_ACTION_1', actionId: 'pm2.reload_app' });

    expect(result).toMatchObject({ actionId: 'pm2.reload_app', outcome: 'completed' });
    expect(calls).toEqual([
      {
        executable: '/usr/bin/pm2',
        args: ['reload', 'edutrack'],
        cwd: undefined,
        env: { PATH: '/usr/bin:/bin', LANG: 'C' },
        timeoutMs: 2_000,
        maxOutputBytes: 128
      }
    ]);
  });

  test('reports next_job without executing or claiming that the job ran', async () => {
    let invoked = false;
    const runner = createActionRunner({
      definitions,
      executor: async () => {
        invoked = true;
        return { exitCode: 0, signal: null, stdoutBytes: 0, stderrBytes: 0, timedOut: false };
      }
    });

    await expect(runner.run({ runId: 'RUN_ACTION_2', actionId: 'job.next_run' })).resolves.toMatchObject({
      actionId: 'job.next_run',
      outcome: 'takes_effect_next_run'
    });
    expect(invoked).toBe(false);
  });

  test('bounds failures and makes replay of a run/action idempotent', async () => {
    let attempts = 0;
    const runner = createActionRunner({
      definitions,
      executor: async () => {
        attempts += 1;
        return { exitCode: 1, signal: null, stdoutBytes: 2_000, stderrBytes: 0, timedOut: false };
      }
    });

    await expect(runner.run({ runId: 'RUN_ACTION_3', actionId: 'pm2.reload_app' })).rejects.toMatchObject({
      code: 'ACTION_FAILED'
    });
    await expect(runner.run({ runId: 'RUN_ACTION_3', actionId: 'pm2.reload_app' })).rejects.toMatchObject({
      code: 'ACTION_FAILED'
    });
    expect(attempts).toBe(1);
  });

  test('rejects caller-selected action settings and unknown actions', async () => {
    const runner = createActionRunner({
      definitions,
      executor: async () => ({ exitCode: 0, signal: null, stdoutBytes: 0, stderrBytes: 0, timedOut: false })
    });

    await expect(
      runner.run({
        runId: 'RUN_ACTION_4',
        actionId: 'pm2.reload_app',
        executable: '/bin/sh',
        args: ['-c', 'sentinel'],
        timeoutMs: 99_999
      } as never)
    ).rejects.toBeInstanceOf(ActionRunnerError);
    await expect(runner.run({ runId: 'RUN_ACTION_5', actionId: 'release.build_redeploy' })).rejects.toMatchObject({
      code: 'ACTION_NOT_ALLOWED'
    });
  });
});
