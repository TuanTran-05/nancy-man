import { describe, expect, it } from 'vitest';
import { assertRollbackReversible } from './rollback.js';
import { createInMemoryDocumentStore } from '../../test-utils/inMemoryDocumentStore.js';

describe('assertRollbackReversible', () => {
  it('throws STUDENT_RETIREMENT_ROLLBACK_IRREVERSIBLE if the boundary exists', async () => {
    const { db } = createInMemoryDocumentStore({
      'student_profile_retirement_irreversible_boundaries/ret-1': {
        runId: 'ret-1',
        actorId: 'migration',
        writtenAt: '2026-09-15T10:00:00.000Z',
      },
    });

    await expect(assertRollbackReversible(db as never, 'ret-1')).rejects.toThrow(
      'STUDENT_RETIREMENT_ROLLBACK_IRREVERSIBLE'
    );
  });

  it('resolves if the boundary does not exist', async () => {
    const { db } = createInMemoryDocumentStore({});
    await expect(assertRollbackReversible(db as never, 'ret-1')).resolves.toBeUndefined();
  });
});
