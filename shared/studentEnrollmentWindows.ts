/**
 * Pure domain helpers for a student's course-join and leave-period history.
 * These arrays preserve when a student belonged to a particular course.
 */
import { isApiDateOnly } from './dateTimeFormat.js';

export type StudentCourseJoin = {
  classId: string;
  termStart: string;
  joinedAt: string;
};

export type StudentLeavePeriod = {
  from: string;
  until: string | null;
  plannedUntil?: string;
  classId: string;
  note?: string;
};

function dateText(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim().slice(0, 10);
  // Use isApiDateOnly to reject impossible calendar dates like 2026-02-30.
  return isApiDateOnly(trimmed) ? trimmed : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

export function readCourseJoins(value: unknown): StudentCourseJoin[] {
  if (!Array.isArray(value)) return [];

  const result: StudentCourseJoin[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const classId = typeof entry.classId === 'string' ? entry.classId : '';
    const termStart = dateText(entry.termStart);
    const joinedAt = dateText(entry.joinedAt);
    if (!classId || !termStart || !joinedAt) continue;
    result.push({ classId, termStart, joinedAt });
  }
  return result;
}

export function readLeavePeriods(value: unknown): StudentLeavePeriod[] {
  if (!Array.isArray(value)) return [];

  const result: StudentLeavePeriod[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const from = dateText(entry.from);
    const classId = typeof entry.classId === 'string' ? entry.classId : '';
    if (!from || !classId) continue;

    // If `until` is present (non-null string), it must be a valid calendar date.
    // Never reinterpret a malformed `until` as open leave (until: null).
    const rawUntil = entry.until;
    let untilText: string | null;
    if (rawUntil === null || rawUntil === undefined) {
      untilText = null;
    } else {
      const parsed = dateText(rawUntil);
      if (!parsed) continue; // malformed `until` — discard the entire row
      untilText = parsed;
    }
    // Reject a closed leave window where until precedes or equals from.
    if (untilText !== null && untilText <= from) continue;

    const plannedUntil = dateText(entry.plannedUntil) || undefined;
    const note = typeof entry.note === 'string' && entry.note ? entry.note : undefined;
    result.push({
      from,
      until: untilText,
      classId,
      ...(plannedUntil ? { plannedUntil } : {}),
      ...(note ? { note } : {}),
    });
  }
  return result;
}
