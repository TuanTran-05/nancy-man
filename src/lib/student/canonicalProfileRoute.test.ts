import { describe, expect, it } from 'vitest';
import { canonicalProfileRedirect } from './canonicalProfileRoute';

describe('canonicalProfileRedirect', () => {
  it('moves a link written before a merge to the surviving profile', () => {
    expect(
      canonicalProfileRedirect({
        requestedStudentId: 'legacy-1',
        canonicalProfileId: 'canonical-1',
        search: '?tab=finance',
      })
    ).toEqual({ pathname: '/students/canonical-1', search: '?tab=finance' });
  });

  it('stays put when the URL already names the canonical profile', () => {
    expect(
      canonicalProfileRedirect({
        requestedStudentId: 'canonical-1',
        canonicalProfileId: 'canonical-1',
      })
    ).toBeNull();
  });

  it('stays put when the server sent no canonical id', () => {
    // A response written before the rollout. Redirecting on a guess would move
    // the user somewhere nothing said they should be.
    expect(
      canonicalProfileRedirect({ requestedStudentId: 'legacy-1', canonicalProfileId: undefined })
    ).toBeNull();
  });

  it('escapes an id that would otherwise change the path', () => {
    expect(
      canonicalProfileRedirect({
        requestedStudentId: 'legacy-1',
        canonicalProfileId: 'a/b?c',
      })
    ).toEqual({ pathname: '/students/a%2Fb%3Fc', search: '' });
  });
});
