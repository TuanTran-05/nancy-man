export type StudentCourseEnrollmentStatus =
  | 'trial'
  | 'active'
  | 'on_leave'
  | 'completed'
  | 'transferred'
  | 'dropped';

export type StudentCourseEnrollmentSource = 'system' | 'backfill' | 'manual';
export type StudentCourseEnrollmentConfidence = 'confirmed' | 'inferred';

export interface StudentCourseEnrollment {
  id: string;
  studentId: string;
  classId: string;
  termStart: string;
  termEnd: string | null;
  status: StudentCourseEnrollmentStatus;
  joinedAt: string;
  endedAt: string | null;
  statusReason: string | null;
  source: StudentCourseEnrollmentSource;
  confidence: StudentCourseEnrollmentConfidence;
  statusChangedAt: string;
  statusChangedBy: string;
  confirmedAt: string | null;
  confirmedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StudentCourseEnrollmentTransitionInput {
  status: StudentCourseEnrollmentStatus;
  endedAt?: string | null;
  statusReason: string | null;
  at: string;
  by: string;
}

const OPEN_STATUSES: readonly StudentCourseEnrollmentStatus[] = [
  'trial',
  'active',
  'on_leave',
];
const CLOSED_STATUSES: readonly StudentCourseEnrollmentStatus[] = [
  'completed',
  'transferred',
  'dropped',
];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T/;

export function isOpenStudentCourseEnrollmentStatus(
  status: StudentCourseEnrollmentStatus
): boolean {
  return OPEN_STATUSES.includes(status);
}

function isDate(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    ISO_TIMESTAMP_PATTERN.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

function requireDate(value: unknown, field: string): string {
  if (!isDate(value)) throw new Error(`${field} must be an ISO date`);
  return value;
}

function optionalDate(value: unknown, field: string): string | null {
  if (value === null) return null;
  return requireDate(value, field);
}

function requireTimestamp(value: unknown, field: string): string {
  if (!isTimestamp(value)) throw new Error(`${field} must be an ISO timestamp`);
  return value;
}

function isEnrollmentStatus(value: unknown): value is StudentCourseEnrollmentStatus {
  return (
    typeof value === 'string' &&
    [...OPEN_STATUSES, ...CLOSED_STATUSES].includes(value as StudentCourseEnrollmentStatus)
  );
}

function isEnrollmentSource(value: unknown): value is StudentCourseEnrollmentSource {
  return value === 'system' || value === 'backfill' || value === 'manual';
}

function isEnrollmentConfidence(value: unknown): value is StudentCourseEnrollmentConfidence {
  return value === 'confirmed' || value === 'inferred';
}

function utf8Bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function base64UrlEncode(value: string): string {
  const bytes = utf8Bytes(value);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let encoded = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    const hasSecond = second !== undefined;
    const hasThird = third !== undefined;
    const word = (first << 16) | ((second ?? 0) << 8) | (third ?? 0);
    encoded += alphabet[(word >> 18) & 63];
    encoded += alphabet[(word >> 12) & 63];
    encoded += hasSecond ? alphabet[(word >> 6) & 63] : '=';
    encoded += hasThird ? alphabet[word & 63] : '=';
  }
  return encoded.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function makeStudentCourseEnrollmentId(
  studentId: string,
  classId: string,
  termStart: string
): string {
  requireString(studentId, 'studentId');
  requireString(classId, 'classId');
  requireDate(termStart, 'termStart');
  return base64UrlEncode(JSON.stringify([studentId, classId, termStart]));
}

export function assertValidStudentCourseEnrollment(value: unknown): StudentCourseEnrollment {
  if (!value || typeof value !== 'object') {
    throw new Error('student course enrollment must be an object');
  }
  const data = value as Record<string, unknown>;
  const studentId = requireString(data.studentId, 'studentId');
  const classId = requireString(data.classId, 'classId');
  const termStart = requireDate(data.termStart, 'termStart');
  const termEnd = optionalDate(data.termEnd, 'termEnd');
  const status = data.status;
  if (!isEnrollmentStatus(status)) throw new Error('status is invalid');
  const joinedAt = requireDate(data.joinedAt, 'joinedAt');
  const endedAt = optionalDate(data.endedAt, 'endedAt');
  const source = data.source;
  if (!isEnrollmentSource(source)) throw new Error('source is invalid');
  const confidence = data.confidence;
  if (!isEnrollmentConfidence(confidence)) throw new Error('confidence is invalid');
  const id = requireString(data.id, 'id');
  if (id !== makeStudentCourseEnrollmentId(studentId, classId, termStart)) {
    throw new Error('enrollment identity does not match its tuple');
  }

  if (termEnd !== null && termEnd < termStart) {
    throw new Error('termEnd cannot precede termStart');
  }
  if (joinedAt < termStart || (termEnd !== null && joinedAt > termEnd)) {
    throw new Error('joinedAt must be within the course term');
  }
  if (isOpenStudentCourseEnrollmentStatus(status)) {
    if (endedAt !== null) throw new Error('open enrollment cannot have endedAt');
  } else if (endedAt === null) {
    throw new Error('closed enrollment requires endedAt');
  } else if (endedAt < joinedAt) {
    throw new Error('endedAt cannot precede joinedAt');
  }

  const statusReason = data.statusReason;
  if (statusReason !== null && typeof statusReason !== 'string') {
    throw new Error('statusReason must be a string or null');
  }
  const statusChangedAt = requireTimestamp(data.statusChangedAt, 'statusChangedAt');
  const statusChangedBy = requireString(data.statusChangedBy, 'statusChangedBy');
  const confirmedAt = data.confirmedAt === null
    ? null
    : requireTimestamp(data.confirmedAt, 'confirmedAt');
  const confirmedBy = data.confirmedBy === null
    ? null
    : requireString(data.confirmedBy, 'confirmedBy');
  if ((confirmedAt === null) !== (confirmedBy === null)) {
    throw new Error('confirmedAt and confirmedBy must be set together');
  }
  const createdAt = requireTimestamp(data.createdAt, 'createdAt');
  const updatedAt = requireTimestamp(data.updatedAt, 'updatedAt');

  return {
    id,
    studentId,
    classId,
    termStart,
    termEnd,
    status,
    joinedAt,
    endedAt,
    statusReason: statusReason as string | null,
    source,
    confidence,
    statusChangedAt,
    statusChangedBy,
    confirmedAt,
    confirmedBy,
    createdAt,
    updatedAt,
  };
}

export function transitionStudentCourseEnrollment(
  current: StudentCourseEnrollment,
  input: StudentCourseEnrollmentTransitionInput
): StudentCourseEnrollment {
  const existing = assertValidStudentCourseEnrollment(current);
  if (!isEnrollmentStatus(input.status)) throw new Error('status is invalid');
  const at = requireTimestamp(input.at, 'at');
  const by = requireString(input.by, 'by');
  const statusReason = input.statusReason;
  if (statusReason !== null && typeof statusReason !== 'string') {
    throw new Error('statusReason must be a string or null');
  }
  const endedAt = isOpenStudentCourseEnrollmentStatus(input.status)
    ? null
    : requireDate(input.endedAt, 'endedAt');

  if (!isOpenStudentCourseEnrollmentStatus(existing.status) && input.status !== existing.status) {
    throw new Error('closed enrollment cannot be reopened by a status transition');
  }

  return assertValidStudentCourseEnrollment({
    ...existing,
    status: input.status,
    endedAt,
    statusReason,
    statusChangedAt: at,
    statusChangedBy: by,
    updatedAt: at,
  });
}
