import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RUNBOOK_PATH = path.join(__dirname, '../docs/runbooks/canonical-student-profile-cutover.md');

/**
 * Parity between the runbook and the commands it tells an operator to run.
 *
 * Checking that `--help` mentions a flag proves only that somebody wrote it
 * into a usage string. What matters at 2am is whether the parser accepts it,
 * so this asks each script's own parser — an unknown flag is the failure this
 * catches, and it is the one that turns a documented step into a command that
 * exits 2.
 */

type Parser = (argv: readonly string[]) => unknown;

function parsersFor(module: Record<string, unknown>): Parser[] {
  return Object.entries(module)
    .filter(([name, value]) => name.startsWith('parse') && typeof value === 'function')
    .map(([, value]) => value as Parser);
}

/**
 * Did the parser reject the flag itself, as opposed to complaining about
 * something else the command line was missing?
 *
 * Only the first is a parity failure. A step that legitimately needs more
 * flags than the snippet shows still proves the flag is known.
 */
function rejectedTheFlag(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  // Both spellings: these parsers were written separately and some report the
  // prose form while others report an error code.
  return /unknown[ _]flag|unexpected[ _]argument/i.test(message);
}

/**
 * The snippet as an argv.
 *
 * Shell variables become a placeholder rather than being dropped: removing
 * them would shift a value into a flag position and turn a parity check into
 * a syntax complaint.
 */
function argvFromSnippet(argsStr: string): string[] {
  return argsStr
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => (token.startsWith('$') ? 'placeholder' : token));
}

describe('runbook parity', () => {
  it('every command the runbook types is one its parser recognises', async () => {
    const runbook = readFileSync(RUNBOOK_PATH, 'utf8');
    const packageJson = JSON.parse(readFileSync(path.join(__dirname, '../package.json'), 'utf8'));

    // Both spellings. The executable snippets say `npm.cmd run`, but the
    // retirement phase names its commands in prose as `npm run`, and a command
    // an operator is told to type is a command whether or not it sits in a
    // fenced block. Matching only the fenced spelling is how two retirement
    // audit aliases stayed in the runbook after the parser stopped accepting
    // them.
    const commands = [...runbook.matchAll(/npm(?:\.cmd)? run ([\w:-]+)(?:\s+--\s+(.*))?/g)];
    let checked = 0;

    for (const [, scriptName, argsStr = ''] of commands) {
      const scriptCmd = packageJson.scripts[scriptName];
      if (!scriptCmd) continue;

      const tsxMatch = scriptCmd.match(/tsx scripts\/(\S+\.ts)/);
      if (!tsxMatch) continue;

      const script = tsxMatch[1];
      if (!existsSync(path.join(__dirname, script))) continue;

      const module = (await import(/* @vite-ignore */ `./${script}`)) as Record<string, unknown>;
      const parsers = parsersFor(module);
      expect(parsers.length, `${script} exports no parser to check parity against`).toBeGreaterThan(
        0
      );

      // The operator types the alias and inherits whatever it pins, then adds
      // the snippet's own flags. Anything the snippet already restates is
      // dropped from the alias half: these parsers treat a repeated flag as an
      // error, and that error would mask the unknown flag this test is for.
      const snippetArgv = argvFromSnippet(argsStr);
      const snippetFlags = new Set(snippetArgv.filter((token) => token.startsWith('--')));
      const aliasTokens = argvFromSnippet(scriptCmd.replace(/^.*\.ts/, ''));
      const aliasArgv: string[] = [];
      for (let index = 0; index < aliasTokens.length; index += 1) {
        const token = aliasTokens[index];
        if (token.startsWith('--') && snippetFlags.has(token)) {
          // Drop the flag and the value that belongs to it. Keeping an
          // orphaned value would land it in a positional slot and read as a
          // syntax error rather than as the duplicate it is.
          if (!aliasTokens[index + 1]?.startsWith('--')) index += 1;
          continue;
        }
        aliasArgv.push(token);
      }
      const argv = [...aliasArgv, ...snippetArgv];
      if (argv.length === 0) continue;

      // The whole command line, exactly as typed. Parsing flags one at a time
      // lets an earlier "you forgot the mode" error hide the unknown flag
      // that is the actual drift.
      const rejection = parsers
        .map((parse) => {
          try {
            parse(argv);
            return null;
          } catch (error) {
            return rejectedTheFlag(error) ? error : null;
          }
        })
        .filter(Boolean);

      expect(
        rejection.length,
        `${script} rejects part of the command line the runbook types: ${
          rejection.map((error) => (error as Error).message).join('; ')
        }`
      ).toBe(0);
      checked += 1;
    }

    // A parity test that silently matched nothing is the failure mode this
    // whole file exists to avoid.
    expect(checked, 'the runbook named no runnable command').toBeGreaterThan(0);
  });

  it('leaves no documented mode without a runner behind it', async () => {
    // Parsing is not running. Both CLIs used to accept a mode, open a
    // database, and then announce that the mode had no implementation — which
    // reads as a broken install at 2am rather than as a step nobody built. The
    // dispatches are exhaustive now, checked by the compiler, so this asserts
    // the fallthrough has not come back.
    const { readFileSync } = await import('node:fs');
    for (const script of [
      'normalize-student-profiles.ts',
      'retire-legacy-student-profiles.ts',
    ]) {
      const source = readFileSync(path.join(__dirname, script), 'utf8');
      expect(source, `${script} still refuses a mode as unimplemented`).not.toContain(
        'MODE_NOT_IMPLEMENTED'
      );
    }
  });
});
