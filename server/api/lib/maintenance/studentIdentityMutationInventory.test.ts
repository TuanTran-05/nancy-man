import { describe, expect, it } from 'vitest';
import {
  STUDENT_IDENTITY_MUTATION_INVENTORY,
  classifyStudentIdentityRouteMutation,
  requiresStudentIdentityMutationGuard,
  type StudentIdentityMutationSurface,
} from './studentIdentityMutationInventory.js';

/**
 * The inventory is the list of ways a student-linked record can change. Its
 * value is entirely in being exhaustive: a route missing from it is a route
 * that keeps writing while the migration has already fingerprinted what it is
 * writing to, and that shows up as drift mid-cutover — or does not show up at
 * all.
 */

function guarded(surface: StudentIdentityMutationSurface, action: string, method = 'POST') {
  return requiresStudentIdentityMutationGuard({ surface, action, method });
}

describe('classifyStudentIdentityRouteMutation', () => {
  it.each([
    ['receipts', 'create-and-post'],
    ['receipts', 'create'],
    ['receipts', 'post'],
    ['receipts', 'void'],
    ['expenses', 'create-and-post'],
    ['expenses', 'create'],
    ['expenses', 'post'],
    ['expenses', 'void'],
    ['invoices', 'create'],
    ['wallet', 'deposit-and-post'],
    ['wallet', 'allocate-and-post'],
    ['wallet', 'void'],
  ])('guards finance %s/%s', (resource, action) => {
    expect(
      classifyStudentIdentityRouteMutation({
        surface: 'finance',
        resource,
        action,
        method: 'POST',
      })
    ).toBe('student_mutation');
  });

  it('returns unclassified_write for unregistered POST actions', () => {
    expect(
      classifyStudentIdentityRouteMutation({
        surface: 'finance',
        resource: 'receipts',
        action: 'future-write',
        method: 'POST',
      })
    ).toBe('unclassified_write');
  });

  it('returns read_only for GET on unregistered actions', () => {
    expect(
      classifyStudentIdentityRouteMutation({
        surface: 'finance',
        resource: 'receipts',
        action: 'future-read',
        method: 'GET',
      })
    ).toBe('read_only');
  });

  it('uses the HTTP method as part of the explicit dispatch key', () => {
    expect(
      classifyStudentIdentityRouteMutation({
        surface: 'students',
        action: 'create',
        method: 'PUT',
      })
    ).toBe('unclassified_write');
  });

  it.each([
    'outbox-process',
    'payment-reconcile',
    'finance-aggregate',
    'dashboard-aggregate',
    'notification-digest',
    'daily-maintenance',
  ])('guards scheduled audit GET and POST dispatches for %s', (action) => {
    for (const method of ['GET', 'POST']) {
      expect(
        classifyStudentIdentityRouteMutation({
          surface: 'audit_jobs',
          action,
          method,
        })
      ).toBe('student_mutation');
    }
  });
});

describe('requiresStudentIdentityMutationGuard', () => {
  it('guards every student-record mutation', () => {
    for (const [action, method] of [
      ['create', 'POST'],
      ['update', 'PUT'],
      ['status', 'PUT'],
      ['siblings', 'POST'],
      ['delete', 'DELETE'],
      ['update-profile', 'POST'],
      ['standardize-student-ids', 'POST'],
      ['import', 'POST'],
      ['transfer', 'POST'],
      ['course-enrollment', 'POST'],
    ]) {
      expect(guarded('students', action, method)).toBe(true);
    }
  });

  it('guards class progression, archival, and course closing', () => {
    for (const [action, method] of [
      ['status', 'PUT'],
      ['delete', 'DELETE'],
      ['import-students', 'POST'],
      ['reset-course', 'POST'],
      ['generate-ledgers', 'POST'],
      ['rebuild-student-counts', 'POST'],
      ['approve-course-closing', 'POST'],
      ['exempt-course-closing-student', 'POST'],
    ]) {
      expect(guarded('classes', action, method)).toBe(true);
    }
  });

  it('guards admissions decisions', () => {
    for (const action of ['trial-decision', 'create-trial', 'add-to-waitlist', 'delete-pending']) {
      expect(guarded('admissions', action)).toBe(true);
    }
  });

  it('guards attendance writes', () => {
    for (const [action, method] of [
      ['toggle', 'POST'],
      ['bulk-toggle', 'POST'],
      ['cycle', 'POST'],
      ['update-detail', 'POST'],
      ['toggle-permission', 'POST'],
      ['delete-record', 'DELETE'],
      ['delete-dates', 'POST'],
    ]) {
      expect(guarded('attendance', action, method)).toBe(true);
    }
  });

  it('guards evaluations, assignments, submissions, and drafts', () => {
    for (const [action, method] of [
      ['assignment-create', 'POST'],
      ['assignment-update', 'PUT'],
      ['assignment-delete', 'DELETE'],
      ['assignment-grade', 'POST'],
      ['assignment-delete-submissions', 'DELETE'],
      ['assignment-draft-publish', 'POST'],
    ]) {
      expect(guarded('education', action, method)).toBe(true);
    }
  });

  it('guards wallet, receipts, invoices, expenses, and ledgers', () => {
    for (const [resource, action] of [
      ['receipts', 'create-and-post'],
      ['expenses', 'create-and-post'],
      ['invoices', 'create'],
      ['wallet', 'deposit-and-post'],
    ]) {
      expect(
        requiresStudentIdentityMutationGuard({
          surface: 'finance',
          resource,
          action,
          method: 'POST',
        })
      ).toBe(true);
    }
  });

  it('guards every PayOS path that can attach money to a student', () => {
    for (const [action, method] of [
      ['create', 'POST'],
      ['webhook', 'POST'],
      ['status', 'GET'],
      ['reconcile', 'POST'],
      ['resolve-review', 'POST'],
    ]) {
      expect(guarded('payments', action, method)).toBe(true);
    }
  });

  it('guards credential and password-reset writes', () => {
    for (const action of [
      'create-password-request',
      'reset',
      'approve',
      'reject-password-reset',
      'verify-student-login',
      'reset-password-zalo',
      'migrate-credentials',
    ]) {
      expect(guarded('student_auth', action)).toBe(true);
    }
  });

  it('guards notification writes that record something against a student', () => {
    for (const action of [
      'notify-absence',
      'notify-evaluation',
      'notify-rank-achievement',
      'notify-tuition-reminder',
      'notify-tuition-notice',
      'notify-payment-confirm',
      'send-notification',
    ]) {
      expect(guarded('messaging', action)).toBe(true);
    }
  });

  it('guards student face ownership', () => {
    expect(guarded('student_face', 'upload-student-face')).toBe(true);
  });

  it('guards the scheduled jobs that write student-linked records', () => {
    for (const action of [
      'outbox-process',
      'payment-reconcile',
      'finance-aggregate',
      'daily-maintenance',
    ]) {
      expect(guarded('audit_jobs', action)).toBe(true);
    }
  });

  it('leaves pure reads alone', () => {
    expect(guarded('students', 'evaluation-insights', 'GET')).toBe(false);
    expect(guarded('education', 'assignment-progress-summary', 'GET')).toBe(false);
    expect(guarded('finance', 'report', 'GET')).toBe(false);
    expect(guarded('messaging', 'zalo-log-summary', 'GET')).toBe(false);
    expect(guarded('classes', 'course-closing-records', 'GET')).toBe(false);
  });

  it('leaves staff-only changes that touch no student record alone', () => {
    for (const action of [
      'save-settings',
      'save-holidays',
      'create-substitute-request',
      'save-availability',
    ]) {
      expect(
        classifyStudentIdentityRouteMutation({
          surface: 'classes',
          action,
          method: 'POST',
        })
      ).toBe('staff_only');
    }
    expect(
      classifyStudentIdentityRouteMutation({
        surface: 'classes',
        action: 'update-salary',
        method: 'PUT',
      })
    ).toBe('staff_only');
  });

  it('classifies admin Zalo manual sends as staff-only', () => {
    expect(
      classifyStudentIdentityRouteMutation({
        surface: 'messaging',
        action: 'admin-manual-send',
        method: 'POST',
      })
    ).toBe('staff_only');
  });

  it('does not guard a GET on an action that mutates by POST', () => {
    expect(guarded('students', 'create', 'GET')).toBe(false);
    expect(guarded('students', 'create', 'POST')).toBe(true);
  });
});

describe('STUDENT_IDENTITY_MUTATION_INVENTORY', () => {
  it('names each surface/resource/action/method distinctly', () => {
    const keys = STUDENT_IDENTITY_MUTATION_INVENTORY.map(
      (route) =>
        route.resource
          ? `${route.surface}:${route.resource}:${route.action}:${route.method}`
          : `${route.surface}:${route.action}:${route.method}`
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('records one normalized method for every dispatch decision', () => {
    for (const route of STUDENT_IDENTITY_MUTATION_INVENTORY) {
      expect(route.method).toBe(route.method.toUpperCase());
      expect(route.method).not.toBe('');
    }
  });

  it('marks the routes that can bring a new student reference into existence', () => {
    const creators = new Set(
      STUDENT_IDENTITY_MUTATION_INVENTORY.filter((route) => route.createsStudentReference).map(
        (route) => `${route.surface}:${route.action}`
      )
    );
    expect(creators).toContain('students:create');
    expect(creators).toContain('students:import');
    expect(creators).toContain('students:course-enrollment');
    expect(creators).toContain('classes:import-students');
    expect(creators).toContain('classes:reset-course');
    expect(creators).toContain('admissions:create-trial');
    expect(creators).not.toContain('students:delete');
  });
});
