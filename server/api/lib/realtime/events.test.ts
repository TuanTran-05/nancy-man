import { describe, expect, it, vi, beforeEach } from 'vitest';

const setMock = vi.fn().mockResolvedValue(undefined);
const docMock = vi.fn(() => ({ set: setMock }));
const collectionMock = vi.fn(() => ({ doc: docMock }));

vi.mock('../auth/verifyAuth.js', () => ({
  getDb: () => ({ collection: collectionMock }),
}));
vi.mock('@/server/db/documentStore.js', () => ({
  FieldValue: {
    increment: (n: number) => ({ __increment: n }),
    serverTimestamp: () => ({ __serverTimestamp: true }),
  },
}));

beforeEach(() => {
  setMock.mockClear();
  docMock.mockClear();
});

describe('touchRealtimeEvent', () => {
  it('writes the new office schedule event', async () => {
    const { touchRealtimeEvent } = await import('./events.js');
    await touchRealtimeEvent('office-schedule-changed');
    expect(docMock).toHaveBeenCalledWith('office-schedule-changed');
    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'office-schedule-changed', targetId: null }),
      { merge: true }
    );
  });

  it('writes the new office academic event', async () => {
    const { touchRealtimeEvent } = await import('./events.js');
    await touchRealtimeEvent('office-academic-changed');
    expect(docMock).toHaveBeenCalledWith('office-academic-changed');
  });

  it('clears an old target when the next event is broad', async () => {
    const { touchRealtimeEvent } = await import('./events.js');
    await touchRealtimeEvent('students');
    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({ targetId: null }),
      { merge: true }
    );
  });

  it('preserves a supplied targetId', async () => {
    const { touchRealtimeEvent } = await import('./events.js');
    await touchRealtimeEvent('students', { targetId: 'student-123' });
    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({ targetId: 'student-123' }),
      { merge: true }
    );
  });
});
