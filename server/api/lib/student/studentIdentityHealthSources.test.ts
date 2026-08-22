import { describe, expect, it } from 'vitest';
import { collectStudentIdentityHealthSources } from './studentIdentityHealthSources.js';
import { createInMemoryDocumentStore } from '../../../../test-utils/inMemoryDocumentStore.js';

describe('collectStudentIdentityHealthSources', () => {
  it('reports a required collection failure as RED with STUDENT_IDENTITY_HEALTH_SOURCE_UNAVAILABLE', async () => {
    const { db } = createInMemoryDocumentStore({});
    // Mock db.collection to throw
    const mutable = db as never as { collection: (name: string) => unknown };
    const originalCollection = mutable.collection.bind(mutable);
    mutable.collection = (name: string) => {
      if (name === 'students') throw new Error('Simulated failure');
      return originalCollection(name);
    };

    const sources = await collectStudentIdentityHealthSources({ db });
    expect(sources.collections.students).toMatchObject({
      ok: false,
      code: 'unavailable',
      source: 'documentStore:students',
    });
  });
});
