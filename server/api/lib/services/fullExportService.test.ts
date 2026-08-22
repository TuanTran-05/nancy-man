import { describe, expect, it, vi } from 'vitest';
import { streamExcelExport, streamSqlExport } from './fullExportService.js';

type ExportDoc = {
  id: string;
  data: () => Record<string, unknown>;
};

function createPagedExportDb(pagesByCollection: Record<string, ExportDoc[][]>) {
  const pageIndexByCollection: Record<string, number> = {};
  const readsByCollection: Record<string, number> = {};
  const db = {
    collection: vi.fn((name: string) => {
      const query: any = {
        orderBy: vi.fn(() => query),
        limit: vi.fn(() => query),
        startAfter: vi.fn(() => query),
        get: vi.fn(async () => {
          readsByCollection[name] = (readsByCollection[name] || 0) + 1;
          const pageIndex = pageIndexByCollection[name] || 0;
          const docs = pagesByCollection[name]?.[pageIndex] || [];
          pageIndexByCollection[name] = pageIndex + 1;
          return { docs, size: docs.length };
        }),
      };
      return query;
    }),
  };
  return { db, readsByCollection };
}

describe('streamSqlExport', () => {
  it('discovers columns across pages before writing first-page rows', async () => {
    const page1 = Array.from({ length: 500 }, (_, index) => ({
      id: `user-${index}`,
      data: () => ({ email: `u${index}@example.com` }),
    }));
    const page2 = [{ id: 'user-500', data: () => ({ email: 'u500@example.com' }) }];
    const { db, readsByCollection } = createPagedExportDb({ users: [page1, page2, page1, page2] });
    const chunks: string[] = [];
    let readsWhenFirstRowWasWritten = 0;

    const result = await streamSqlExport(db as any, (chunk) => {
      chunks.push(chunk);
      if (chunk.includes('user-0')) {
        readsWhenFirstRowWasWritten = readsByCollection.users;
      }
    });

    expect(readsWhenFirstRowWasWritten).toBe(3); // 2 pages read for getCollectionColumns + 1 page read for streaming
    expect(chunks.join('')).toContain('user-500');
    expect(result).toMatchObject({ exportedCollections: 1, rows: 501 });
  });
});

describe('streamExcelExport', () => {
  it('discovers columns across pages before streaming worksheet rows', async () => {
    const page1 = Array.from({ length: 500 }, (_, index) => ({
      id: `student-${index}`,
      data: () => ({ name: `Student ${index}` }),
    }));
    const page2 = [
      { id: 'student-500', data: () => ({ name: 'Student 500', enrollmentStatus: 'active' }) },
    ];
    const { db } = createPagedExportDb({ students: [page1, page2, page1, page2] });
    const chunks: string[] = [];

    const result = await streamExcelExport(db as any, (chunk) => {
      chunks.push(chunk);
    });
    const xml = chunks.join('');

    expect(xml).toContain('<Data ss:Type="String">enrollmentStatus</Data>');
    expect(xml).toContain('<Data ss:Type="String">active</Data>');
    expect(result).toMatchObject({ exportedCollections: 1, rows: 501 });
  });
});
