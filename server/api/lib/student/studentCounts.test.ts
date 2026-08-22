import { describe, expect, it, vi } from 'vitest';
import { applyClassStudentCountDeltas } from './studentCounts.js';

vi.mock('@/server/db/documentStore.js', () => ({
  FieldValue: {
    increment: vi.fn((value: number) => `increment:${value}`),
    serverTimestamp: vi.fn(() => 'serverTimestamp'),
  },
}));

describe('applyClassStudentCountDeltas', () => {
  it('updates status buckets without changing total for a status transition in one class', () => {
    const classRef = { id: 'class-1' };
    const db = { collection: vi.fn(() => ({ doc: vi.fn(() => classRef) })) };
    const writer = { update: vi.fn() };

    applyClassStudentCountDeltas(writer as any, db as any, [
      {
        before: { classId: 'class-1', enrollmentStatus: 'active' },
        after: { classId: 'class-1', enrollmentStatus: 'on_leave' },
      },
    ]);

    expect(writer.update).toHaveBeenCalledWith(classRef, {
      'studentCounts.active': 'increment:-1',
      'studentCounts.onLeave': 'increment:1',
      updatedAt: 'serverTimestamp',
    });
  });

  it('moves all class count buckets when a trial student is assigned to another class', () => {
    const refs = {
      old: { id: 'class-old' },
      next: { id: 'class-next' },
    };
    const db = {
      collection: vi.fn(() => ({
        doc: vi.fn((id: string) => (id === 'class-old' ? refs.old : refs.next)),
      })),
    };
    const writer = { update: vi.fn() };

    applyClassStudentCountDeltas(writer as any, db as any, [
      {
        before: {
          classId: 'class-old',
          enrollmentStatus: 'active',
          studentLifecycle: 'trial',
        },
        after: {
          classId: 'class-next',
          enrollmentStatus: 'active',
          studentLifecycle: 'enrolled',
        },
      },
    ]);

    expect(writer.update).toHaveBeenCalledWith(
      refs.old,
      expect.objectContaining({
        'studentCounts.total': 'increment:-1',
        'studentCounts.active': 'increment:-1',
        'studentCounts.trial': 'increment:-1',
      })
    );
    expect(writer.update).toHaveBeenCalledWith(
      refs.next,
      expect.objectContaining({
        'studentCounts.total': 'increment:1',
        'studentCounts.active': 'increment:1',
      })
    );
  });
});
