import { describe, expect, it } from 'vitest';
import type { ApiRequest } from '../../lib/http/types.js';
import type { DocumentStore } from '../../../db/documentStore.js';
import {
  readPrintRequestDocuments,
  readSubstituteRequestDocuments,
  readTeacherAvailabilityDocuments,
} from './frontendCollectionsDocument.js';

type Row = { id: string; [key: string]: unknown };

function memoryDb(collections: Record<string, Row[]>): DocumentStore {
  const createQuery = (name: string, source: Row[]) => {
    let rows = [...source];
    let maximum = Number.POSITIVE_INFINITY;
    const query = {
      where(field: string, operation: string, expected: unknown) {
        if (operation !== '==') throw new Error(`Unsupported test operation: ${operation}`);
        rows = rows.filter((row) => row[field] === expected);
        return query;
      },
      orderBy(field: string, direction: 'asc' | 'desc' = 'asc') {
        rows.sort((left, right) =>
          String(left[field] ?? '').localeCompare(String(right[field] ?? '')) *
          (direction === 'desc' ? -1 : 1)
        );
        return query;
      },
      limit(value: number) {
        maximum = value;
        return query;
      },
      async get() {
        const docs = rows.slice(0, maximum).map((row) => ({
          id: row.id,
          exists: true,
          data: () => Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'id')),
        }));
        return { docs, size: docs.length, empty: docs.length === 0 };
      },
    };
    return query;
  };

  return {
    collection(name: string) {
      return createQuery(name, collections[name] || []);
    },
  } as unknown as DocumentStore;
}

function request(query: Record<string, string> = {}): ApiRequest {
  return { query } as unknown as ApiRequest;
}

describe('frontend document collection reads', () => {
  it('keeps teacher substitute visibility on the same document source as writes', async () => {
    const db = memoryDb({
      substitute_requests: [
        { id: 'pending-other', status: 'pending', requestingTeacherId: 'other', date: '2026-08-03' },
        { id: 'own', status: 'accepted', requestingTeacherId: 'teacher-1', date: '2026-08-02' },
        { id: 'assigned', status: 'accepted', requestingTeacherId: 'other', substituteTeacherId: 'teacher-1', date: '2026-08-01' },
        { id: 'private', status: 'accepted', requestingTeacherId: 'other', date: '2026-07-31' },
      ],
    });

    const result = await readSubstituteRequestDocuments(
      db,
      { uid: 'teacher-1', role: 'teacher', name: 'Teacher One' },
      request()
    );
    expect(result.requests.map((row) => row.id)).toEqual(['pending-other', 'own', 'assigned']);
  });

  it('applies print request filters before returning documents', async () => {
    const db = memoryDb({
      print_requests: [
        { id: 'match', teacherId: 'teacher-1', status: 'pending', neededDate: '2026-08-20', createdAt: '2026-08-19' },
        { id: 'other-teacher', teacherId: 'teacher-2', status: 'pending', neededDate: '2026-08-20', createdAt: '2026-08-19' },
        { id: 'printed', teacherId: 'teacher-1', status: 'printed', neededDate: '2026-08-20', createdAt: '2026-08-18' },
      ],
    });

    const result = await readPrintRequestDocuments(
      db,
      { uid: 'teacher-1', role: 'teacher', name: 'Teacher One' },
      request({ status: 'pending', neededDate: '2026-08-20' })
    );
    expect(result.requests.map((row) => row.id)).toEqual(['match']);
  });

  it('scopes availability profiles to the signed-in teacher', async () => {
    const db = memoryDb({
      teacher_availability_profiles: [
        { id: 'teacher-1', teacherId: 'teacher-1', teacherName: 'One' },
        { id: 'teacher-2', teacherId: 'teacher-2', teacherName: 'Two' },
      ],
    });
    const result = await readTeacherAvailabilityDocuments(
      db,
      { uid: 'teacher-1', role: 'teacher', name: 'Teacher One' },
      request({ view: 'profiles' })
    );
    expect(result.profiles.map((row) => row.id)).toEqual(['teacher-1']);
  });
});
