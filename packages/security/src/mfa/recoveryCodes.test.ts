import { describe, expect, it } from 'vitest';

import { consumeRecoveryCode, issueRecoveryCodes } from './recoveryCodes.js';

describe('recovery codes', () => {
  it('issues ten distinct one-time codes and atomically consumes only the matching code', async () => {
    const issued = issueRecoveryCodes(() => '12345678');
    const used = new Set<string>();
    const repository = {
      consumeIfUnused: async (codeHash: string) => {
        if (used.has(codeHash)) return false;
        used.add(codeHash);
        return true;
      }
    };

    expect(issued.plainCodes).toHaveLength(10);
    expect(new Set(issued.plainCodes).size).toBe(10);
    await expect(
      consumeRecoveryCode(issued.plainCodes[0]!, issued.codeHashes, repository)
    ).resolves.toBe(true);
    await expect(
      consumeRecoveryCode(issued.plainCodes[0]!, issued.codeHashes, repository)
    ).resolves.toBe(false);
  });
});
