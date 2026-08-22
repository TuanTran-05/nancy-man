import { describe, expect, it } from 'vitest';
import { parseStudentProfileNormalizationArgs } from './normalize-student-profiles.js';

const SHA = 'a'.repeat(40);
const DIGEST = 'b'.repeat(64);

const PRELIMINARY = [
  '--audit-preliminary',
  '--run-id', 'run-1',
  '--report-dir', 'scratch/run-1',
  '--source-commit', SHA,
];

const FINAL = [
  '--audit-final',
  '--run-id', 'run-1',
  '--report-dir', 'scratch/run-1',
  '--source-commit', SHA,
  '--review-decisions', 'decisions.json',
  '--export-operation', 'op-1',
  '--export-uri', 'gs://backups/x',
  '--rollback-artifact', 'rollback.enc',
];

const APPLY = [
  '--apply',
  // Preflight opens the before-images before it will let an apply start, so
  // the artifact is as required as the plan is.
  '--rollback-artifact', 'rollback.json',
  '--reviewed-plan', 'reviewed.json',
  '--confirm-plan-digest', DIGEST,
  '--confirm-approval-digest', DIGEST,
  '--confirm-project', 'edutrack-prod',
  '--confirm-database', 'edutrack',
  '--confirm-commit', SHA,
  '--confirm-export', 'op-1',
  '--actor-id', 'admin:tt',
  '--drain-evidence', 'drain.json',
  '--report-dir', 'scratch/run-1-apply',
];

const PREPARE = [
  '--prepare',
  '--reviewed-plan', 'reviewed.json',
  '--rollback-artifact', 'rollback.enc',
  '--confirm-plan-digest', DIGEST,
  '--confirm-approval-digest', DIGEST,
  '--confirm-project', 'edutrack-prod',
  '--confirm-database', 'edutrack',
  '--confirm-commit', SHA,
  '--confirm-export', 'projects/edutrack-prod/databases/edutrack/operations/op-1',
  '--actor-id', 'admin:tt',
];

describe('mode selection', () => {
  it('parses a preliminary audit', () => {
    expect(parseStudentProfileNormalizationArgs(PRELIMINARY)).toMatchObject({
      mode: 'audit-preliminary',
      runId: 'run-1',
      reportDir: 'scratch/run-1',
      sourceCommit: SHA,
    });
  });

  it('parses a final audit with its evidence inputs', () => {
    expect(parseStudentProfileNormalizationArgs(FINAL)).toMatchObject({
      mode: 'audit-final',
      reviewDecisionsPath: 'decisions.json',
      exportOperationId: 'op-1',
      exportUri: 'gs://backups/x',
      rollbackArtifactPath: 'rollback.enc',
    });
  });

  it('parses an apply with every confirmation', () => {
    expect(parseStudentProfileNormalizationArgs(APPLY)).toMatchObject({
      mode: 'apply',
      confirmProjectId: 'edutrack-prod',
      confirmDatabaseId: 'edutrack',
      actorId: 'admin:tt',
    });
  });

  it('parses the create-only run preparation before maintenance', () => {
    expect(parseStudentProfileNormalizationArgs(PREPARE)).toMatchObject({
      mode: 'prepare',
      reviewedPlanPath: 'reviewed.json',
      rollbackArtifactPath: 'rollback.enc',
    });
  });

  it('requires exactly one mode', () => {
    expect(() => parseStudentProfileNormalizationArgs([])).toThrow(
      'STUDENT_PROFILE_CLI_MODE_REQUIRED'
    );
  });

  it('rejects two modes in one invocation', () => {
    expect(() =>
      parseStudentProfileNormalizationArgs([...PRELIMINARY, '--apply'])
    ).toThrow('STUDENT_PROFILE_CLI_MODE_CONFLICT');
  });

  it('rejects an unknown flag rather than ignoring it', () => {
    // A silently ignored flag is how an operator believes a safety option is
    // in effect when it is not.
    expect(() =>
      parseStudentProfileNormalizationArgs([...PRELIMINARY, '--yolo'])
    ).toThrow('STUDENT_PROFILE_CLI_UNKNOWN_FLAG');
  });

  it('rejects a flag that is valid only for another mode', () => {
    expect(() =>
      parseStudentProfileNormalizationArgs([...PRELIMINARY, '--actor-id', 'admin:tt'])
    ).toThrow('STUDENT_PROFILE_CLI_FLAG_NOT_ALLOWED');
  });

  it('rejects a flag given without a value', () => {
    expect(() =>
      parseStudentProfileNormalizationArgs(['--audit-preliminary', '--run-id'])
    ).toThrow('STUDENT_PROFILE_CLI_FLAG_MISSING_VALUE');
  });

  it('rejects a repeated flag instead of taking the last one', () => {
    expect(() =>
      parseStudentProfileNormalizationArgs([...PRELIMINARY, '--run-id', 'run-2'])
    ).toThrow('STUDENT_PROFILE_CLI_FLAG_REPEATED');
  });
});

describe('required confirmations', () => {
  it.each([
    ['--run-id', '--audit-preliminary'],
    ['--report-dir', '--audit-preliminary'],
    ['--source-commit', '--audit-preliminary'],
  ])('rejects a preliminary audit missing %s', (missing) => {
    const argv = PRELIMINARY.filter(
      (arg, index) => arg !== missing && PRELIMINARY[index - 1] !== missing
    );

    expect(() => parseStudentProfileNormalizationArgs(argv)).toThrow(
      'STUDENT_PROFILE_CLI_FLAG_REQUIRED'
    );
  });

  it.each([
    '--confirm-plan-digest',
    '--confirm-approval-digest',
    '--confirm-project',
    '--confirm-database',
    '--confirm-commit',
    '--confirm-export',
    '--actor-id',
  ])('rejects an apply missing %s', (missing) => {
    const argv = APPLY.filter((arg, index) => arg !== missing && APPLY[index - 1] !== missing);

    expect(() => parseStudentProfileNormalizationArgs(argv)).toThrow(
      'STUDENT_PROFILE_CLI_FLAG_REQUIRED'
    );
  });

  it('rejects a final audit missing its export evidence', () => {
    const argv = FINAL.filter(
      (arg, index) => arg !== '--export-operation' && FINAL[index - 1] !== '--export-operation'
    );

    expect(() => parseStudentProfileNormalizationArgs(argv)).toThrow(
      'STUDENT_PROFILE_CLI_FLAG_REQUIRED'
    );
  });

  it('rejects a malformed digest confirmation', () => {
    const argv = APPLY.map((arg) => (arg === DIGEST ? 'not-a-digest' : arg));

    expect(() => parseStudentProfileNormalizationArgs(argv)).toThrow(
      'STUDENT_PROFILE_CLI_DIGEST_MALFORMED'
    );
  });
});

describe('secret handling', () => {
  it.each([
    '--rollback-key',
    '--rollback-key-base64',
    '--student-profile-rollback-key-base64',
  ])('refuses to accept the rollback key as %s', (flag) => {
    // argv is visible in process listings and shell history. The key is read
    // from the environment by the artifact module and has no CLI form at all.
    expect(() =>
      parseStudentProfileNormalizationArgs([...FINAL, flag, 'c2VjcmV0'])
    ).toThrow('STUDENT_PROFILE_CLI_SECRET_FLAG_FORBIDDEN');
  });

  it('does not echo a forbidden value in the error it raises', () => {
    try {
      parseStudentProfileNormalizationArgs([...FINAL, '--rollback-key', 'c2VjcmV0LXZhbHVl']);
      throw new Error('should have thrown');
    } catch (error) {
      expect(String(error)).not.toContain('c2VjcmV0LXZhbHVl');
    }
  });
});

describe('help', () => {
  it('is its own mode so it can print without touching Firebase', () => {
    expect(parseStudentProfileNormalizationArgs(['--help'])).toMatchObject({ mode: 'help' });
  });

  it('wins over any other mode present', () => {
    expect(parseStudentProfileNormalizationArgs([...APPLY, '--help'])).toMatchObject({
      mode: 'help',
    });
  });
});

describe('rollback modes', () => {
  it('parses a rollback plan request', () => {
    expect(
      parseStudentProfileNormalizationArgs([
        '--rollback-plan',
        '--reviewed-plan', 'reviewed.json',
        '--confirm-plan-digest', DIGEST,
        '--confirm-approval-digest', DIGEST,
        '--confirm-project', 'edutrack-prod',
        '--confirm-database', 'edutrack',
        '--run-id', 'run-1',
        '--output', 'rollback-plan.json',
      ])
    ).toMatchObject({ mode: 'rollback-plan', outputPath: 'rollback-plan.json' });
  });

  it('parses a rollback apply with its own digest confirmation', () => {
    expect(
      parseStudentProfileNormalizationArgs([
        '--rollback-apply',
        '--reviewed-rollback', 'reviewed-rollback.json',
        '--rollback-artifact', 'rollback.enc',
        '--confirm-rollback-digest', DIGEST,
        '--confirm-project', 'edutrack-prod',
        '--confirm-database', 'edutrack',
        '--run-id', 'run-1',
        '--actor-id', 'admin:tt',
      ])
    ).toMatchObject({ mode: 'rollback-apply', confirmRollbackDigest: DIGEST });
  });

  it('names the rollback plan input --rollback-plan-file, not --rollback-plan', () => {
    // The written plan spelled both the mode selector and this value flag
    // `--rollback-plan`, which cannot parse: the mode takes no value. The
    // value flag is renamed; the mode keeps the documented name.
    expect(
      parseStudentProfileNormalizationArgs([
        '--rollback-approve',
        '--rollback-plan-file', 'rollback-plan.json',
        '--approval-role', 'rollback_finance',
        '--reviewer-id', 'r2',
        '--confirm-rollback-digest', DIGEST,
        '--output', 'reviewed-rollback.json',
      ])
    ).toMatchObject({ mode: 'rollback-approve', rollbackPlanPath: 'rollback-plan.json' });

    expect(() =>
      parseStudentProfileNormalizationArgs([
        '--rollback-approve',
        '--rollback-plan', 'rollback-plan.json',
        '--approval-role', 'rollback_finance',
        '--reviewer-id', 'r2',
        '--confirm-rollback-digest', DIGEST,
        '--output', 'reviewed-rollback.json',
      ])
    ).toThrow('STUDENT_PROFILE_CLI_MODE_CONFLICT');
  });

  it('rejects an approval role the gate does not recognize', () => {
    expect(() =>
      parseStudentProfileNormalizationArgs([
        '--approve',
        '--plan', 'plan.json',
        '--approval-role', 'headmaster',
        '--reviewer-id', 'r1',
        '--confirm-plan-digest', DIGEST,
        '--output', 'reviewed.json',
      ])
    ).toThrow('STUDENT_PROFILE_CLI_ROLE_UNKNOWN');
  });

  it('accepts each recognized approval role', () => {
    for (const role of ['identity_technical', 'finance', 'auth_security']) {
      expect(
        parseStudentProfileNormalizationArgs([
          '--approve',
          '--plan', 'plan.json',
          '--approval-role', role,
          '--reviewer-id', 'r1',
          '--confirm-plan-digest', DIGEST,
          '--output', 'reviewed.json',
        ])
      ).toMatchObject({ mode: 'approve', approvalRole: role });
    }
  });
});
