import type { Student, SafeStudent } from '../../types';

const CREDENTIAL_KEYS = [
  'loginPasswordHash',
  'loginPasswordSalt',
  'passwordVersion',
  'parentPasswordHash',
  'parentPasswordSalt',
  'parentPasswordVersion',
] as const;

/**
 * Remove credential fields from a student document before storing in client state.
 * Defense-in-depth: even if PostgreSQL API rules allow reading the full doc,
 * credentials should never reach the browser.
 */
export function stripStudentCredentials(student: Student): SafeStudent {
  const {
    loginPasswordHash: _1,
    loginPasswordSalt: _2,
    passwordVersion: _3,
    parentPasswordHash: _4,
    parentPasswordSalt: _5,
    parentPasswordVersion: _6,
    ...safe
  } = student;
  return safe as SafeStudent;
}
