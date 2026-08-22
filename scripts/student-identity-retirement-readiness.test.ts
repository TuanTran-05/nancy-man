import { describe, expect, it } from 'vitest';
import { runStudentIdentityArchitectureCheck } from './check-student-identity-architecture.js';
import { STUDENT_IDENTITY_ARCHITECTURE_ALLOWLIST } from './student-identity-architecture-allowlist.js';

/**
 * The check that stands between the retirement window and a silent outage.
 * A query that still reads a retired linked-user field can silently return an
 * empty result, so this remains a blocker for the retirement window.
 */
describe('retirement readiness: readers of removed fields', () => {
  it('has no production query left on users.classId', async () => {
    const { violations } = runStudentIdentityArchitectureCheck(['--policy', 'post-retirement']);
    const linkedUserQueries = violations.filter(
      (violation) => violation.code === 'AUTHORITATIVE_LINKED_USER_CLASS_QUERY'
    );

    expect(
      linkedUserQueries.map((violation) => `${violation.path}:${violation.line}`)
    ).toEqual([]);
  });

  it('holds no allowlist exception for one either', () => {
    const exceptions = STUDENT_IDENTITY_ARCHITECTURE_ALLOWLIST.filter((entry) =>
      entry.path.includes('deltaRecipients')
    );

    expect(exceptions).toEqual([]);
  });
});
