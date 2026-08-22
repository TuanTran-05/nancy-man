import { createHash, timingSafeEqual } from 'node:crypto';

export type FrozenMessage = {
  templateData: Record<string, string | number>;
};

export type FrozenRecipient = {
  studentDocId: string;
  studentCode: string;
  studentName: string;
  phone: string;
  evaluation: FrozenMessage;
  rank: FrozenMessage | null;
  tuition: FrozenMessage;
};

export type OfficeAcademicZaloSnapshotPayload = {
  schemaVersion: 1;
  createdAt: string;
  classId: string;
  className: string;
  courseStartDate: string;
  courseEndDate: string;
  tuitionAmount: number;
  resendBy: string;
  expectedCounts: { evaluation: number; rank: number; tuition: number };
  recipients: FrozenRecipient[];
};

export type OfficeAcademicZaloSnapshot = {
  algorithm: 'sha256';
  checksum: string;
  payload: OfficeAcademicZaloSnapshotPayload;
};

export type SnapshotExpectations = {
  classId: string;
  tuitionAmount: number;
  evaluationCount: number;
  rankCount: number;
  tuitionCount: number;
};

export type SnapshotMessageType =
  | 'evaluation_notice'
  | 'rank_achievement'
  | 'tuition_notice';

export type SnapshotSendPlanRow = {
  studentDocId: string;
  studentCode: string;
  studentName: string;
  classId: string;
  className: string;
  resendBy: string;
  type: SnapshotMessageType;
  phone: string;
  templateData: Record<string, string | number>;
};

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)])
    );
  }
  return value;
}

function checksumPayload(payload: OfficeAcademicZaloSnapshotPayload): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(payload))).digest('hex');
}

export function createSnapshot(
  payload: OfficeAcademicZaloSnapshotPayload
): OfficeAcademicZaloSnapshot {
  return { algorithm: 'sha256', checksum: checksumPayload(payload), payload };
}

function assertChecksum(snapshot: OfficeAcademicZaloSnapshot): void {
  if (snapshot.algorithm !== 'sha256' || !/^[a-f0-9]{64}$/.test(snapshot.checksum)) {
    throw new Error('Invalid snapshot checksum');
  }
  const actual = Buffer.from(checksumPayload(snapshot.payload), 'hex');
  const expected = Buffer.from(snapshot.checksum, 'hex');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new Error('Snapshot checksum mismatch');
  }
}

function requireFields(
  type: 'evaluation' | 'rank' | 'tuition',
  data: Record<string, string | number>,
  fields: string[]
): void {
  for (const field of fields) {
    if (data[field] === undefined || data[field] === null || String(data[field]).trim() === '') {
      throw new Error(`Missing ${type} template field ${field}`);
    }
  }
}

export function verifySnapshot(
  snapshot: OfficeAcademicZaloSnapshot,
  expectations: SnapshotExpectations
): { evaluationCount: number; rankCount: number; tuitionCount: number } {
  assertChecksum(snapshot);
  const payload = snapshot.payload;
  if (payload.schemaVersion !== 1) throw new Error(`Unsupported schema ${payload.schemaVersion}`);
  if (payload.classId !== expectations.classId) {
    throw new Error(`Expected class ${expectations.classId}, received ${payload.classId}`);
  }
  if (payload.tuitionAmount !== expectations.tuitionAmount) {
    throw new Error(
      `Expected tuition ${expectations.tuitionAmount}, received ${payload.tuitionAmount}`
    );
  }

  const documentIds = new Set<string>();
  const studentCodes = new Set<string>();
  let rankCount = 0;
  for (const recipient of payload.recipients) {
    if (documentIds.has(recipient.studentDocId)) throw new Error('Duplicate student document ID');
    if (studentCodes.has(recipient.studentCode)) throw new Error('Duplicate student code');
    documentIds.add(recipient.studentDocId);
    studentCodes.add(recipient.studentCode);
    if (!/^84(?:3|5|7|8|9)\d{8}$/.test(recipient.phone)) {
      throw new Error(`Invalid normalized VN phone for ${recipient.studentCode}`);
    }
    requireFields('evaluation', recipient.evaluation.templateData, [
      'student_name',
      'student_code',
      'course_end_date',
      'final_grade',
      'good',
      'bad',
    ]);
    if (recipient.rank) {
      rankCount += 1;
      requireFields('rank', recipient.rank.templateData, [
        'student_name',
        'student_code',
        'rank',
        'discount',
      ]);
    }
    requireFields('tuition', recipient.tuition.templateData, [
      'student_name',
      'student_code',
      'previous_end_date',
      'start_date',
      'end_date',
      'amount',
      'due_date',
    ]);
    if (Number(recipient.tuition.templateData.amount) !== payload.tuitionAmount) {
      throw new Error(`Tuition payload mismatch for ${recipient.studentCode}`);
    }
  }

  const counts = {
    evaluationCount: payload.recipients.length,
    rankCount,
    tuitionCount: payload.recipients.length,
  };
  const stored = payload.expectedCounts;
  if (
    stored.evaluation !== counts.evaluationCount ||
    stored.rank !== counts.rankCount ||
    stored.tuition !== counts.tuitionCount
  ) {
    throw new Error('Stored snapshot counts do not match recipients');
  }
  for (const [label, expected, actual] of [
    ['evaluation', expectations.evaluationCount, counts.evaluationCount],
    ['rank', expectations.rankCount, counts.rankCount],
    ['tuition', expectations.tuitionCount, counts.tuitionCount],
  ] as const) {
    if (expected !== actual) throw new Error(`Expected ${label} count ${expected}, received ${actual}`);
  }
  return counts;
}

export function buildSnapshotSendPlan(
  snapshot: OfficeAcademicZaloSnapshot
): SnapshotSendPlanRow[] {
  const { payload } = snapshot;
  return payload.recipients.flatMap((recipient) => {
    const base = {
      studentDocId: recipient.studentDocId,
      studentCode: recipient.studentCode,
      studentName: recipient.studentName,
      classId: payload.classId,
      className: payload.className,
      resendBy: payload.resendBy,
      phone: recipient.phone,
    };
    return [
      { ...base, type: 'evaluation_notice' as const, templateData: recipient.evaluation.templateData },
      ...(recipient.rank
        ? [{ ...base, type: 'rank_achievement' as const, templateData: recipient.rank.templateData }]
        : []),
      { ...base, type: 'tuition_notice' as const, templateData: recipient.tuition.templateData },
    ];
  });
}
