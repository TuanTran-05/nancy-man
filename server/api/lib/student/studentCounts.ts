import { FieldValue, type DocumentReference, type DocumentStore } from '@/server/db/documentStore.js';

type StudentCountRecord = Record<string, unknown> | null | undefined;

export type StudentCountTransition = {
  before?: StudentCountRecord;
  after?: StudentCountRecord;
};

type CountWriter = {
  update(ref: DocumentReference, data: Record<string, unknown>): unknown;
};

const COUNT_BUCKETS = ['total', 'active', 'trial', 'onLeave', 'dropped', 'promoted'] as const;

type CountBucket = (typeof COUNT_BUCKETS)[number];
type ClassDeltas = Partial<Record<CountBucket, number>>;

function classIdOf(student: StudentCountRecord): string {
  return typeof student?.classId === 'string' ? student.classId : '';
}

function statusBucketOf(student: StudentCountRecord): CountBucket {
  const status = student?.enrollmentStatus;
  if (status === 'on_leave') return 'onLeave';
  if (status === 'dropped') return 'dropped';
  if (status === 'promoted') return 'promoted';
  return 'active';
}

function addDelta(
  deltasByClass: Map<string, ClassDeltas>,
  student: StudentCountRecord,
  direction: -1 | 1
) {
  const classId = classIdOf(student);
  if (!classId) return;
  const deltas = deltasByClass.get(classId) || {};
  deltas.total = (deltas.total || 0) + direction;
  const statusBucket = statusBucketOf(student);
  deltas[statusBucket] = (deltas[statusBucket] || 0) + direction;
  if (student?.studentLifecycle === 'trial') {
    deltas.trial = (deltas.trial || 0) + direction;
  }
  deltasByClass.set(classId, deltas);
}

export function applyClassStudentCountDeltas(
  writer: CountWriter,
  db: DocumentStore,
  transitions: StudentCountTransition[]
): number {
  const deltasByClass = new Map<string, ClassDeltas>();
  transitions.forEach(({ before, after }) => {
    addDelta(deltasByClass, before, -1);
    addDelta(deltasByClass, after, 1);
  });

  let updatedClasses = 0;
  deltasByClass.forEach((deltas, classId) => {
    const updateData: Record<string, unknown> = {};
    COUNT_BUCKETS.forEach((bucket) => {
      const delta = deltas[bucket] || 0;
      if (delta !== 0) updateData[`studentCounts.${bucket}`] = FieldValue.increment(delta);
    });
    if (Object.keys(updateData).length === 0) return;
    updateData.updatedAt = FieldValue.serverTimestamp();
    writer.update(db.collection('classes').doc(classId), updateData);
    updatedClasses += 1;
  });
  return updatedClasses;
}
