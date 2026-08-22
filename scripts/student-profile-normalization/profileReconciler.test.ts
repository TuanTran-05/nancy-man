import { describe, expect, it } from 'vitest';
import { reconcileStudentProfileFields } from './profileReconciler.js';

function source(id: string, data: Record<string, unknown>) {
  return { id, data };
}

describe('reconcileStudentProfileFields', () => {
  it('takes the earliest credible createdAt across all merged profiles', () => {
    const { decisions, canonicalPatch, blockers } = reconcileStudentProfileFields({
      canonicalProfileId: 'canonical-1',
      profiles: [
        source('canonical-1', { createdAt: '2026-03-01T00:00:00.000Z' }),
        source('legacy-1', { createdAt: '2026-01-15T00:00:00.000Z' }),
      ],
    });
    expect(blockers).toEqual([]);
    expect(canonicalPatch.createdAt).toBe('2026-01-15T00:00:00.000Z');
    expect(decisions.find((d) => d.fieldPath === 'createdAt')?.action).toBe('earliest_timestamp');
  });

  it('never uses migration time as a substitute for a missing business timestamp', () => {
    const { canonicalPatch, decisions } = reconcileStudentProfileFields({
      canonicalProfileId: 'canonical-1',
      profiles: [source('canonical-1', {}), source('legacy-1', {})],
    });
    expect(canonicalPatch.createdAt).toBeUndefined();
    expect(decisions.find((d) => d.fieldPath === 'createdAt')).toBeUndefined();
  });

  it('retains an exact non-empty canonical identity value and does not overwrite it', () => {
    const { canonicalPatch, decisions } = reconcileStudentProfileFields({
      canonicalProfileId: 'canonical-1',
      profiles: [source('canonical-1', { name: 'QUÁCH HOÀNG MINH' }), source('legacy-1', { name: 'QUÁCH HOÀNG MINH' })],
    });
    expect(canonicalPatch.name).toBeUndefined();
    expect(decisions.find((d) => d.fieldPath === 'name')?.action).toBe('keep_canonical');
  });

  it('copies an identity field the canonical profile never had from the one legacy profile that does', () => {
    const { canonicalPatch, decisions } = reconcileStudentProfileFields({
      canonicalProfileId: 'canonical-1',
      profiles: [source('canonical-1', { gender: '' }), source('legacy-1', { gender: 'male' })],
    });
    expect(canonicalPatch.gender).toBe('male');
    expect(decisions.find((d) => d.fieldPath === 'gender')?.action).toBe('copy_from_profile');
  });

  it('blocks on a conflicting identity field instead of guessing, and emits no patch for it', () => {
    const { canonicalPatch, blockers } = reconcileStudentProfileFields({
      canonicalProfileId: 'canonical-1',
      profiles: [source('canonical-1', { dob: '2014-05-02' }), source('legacy-1', { dob: '2014-05-03' })],
    });
    expect(canonicalPatch.dob).toBeUndefined();
    expect(blockers).toContainEqual(
      expect.objectContaining({ code: 'IDENTITY_FIELD_CONFLICT', detail: expect.stringContaining('dob') })
    );
  });

  it('resolves a conflict only when an approved source decision names it', () => {
    const { canonicalPatch, blockers } = reconcileStudentProfileFields({
      canonicalProfileId: 'canonical-1',
      profiles: [source('canonical-1', { contact: '0900000000' }), source('legacy-1', { contact: '0911111111' })],
      approvedFieldSources: { contact: 'legacy-1' },
    });
    expect(canonicalPatch.contact).toBe('0911111111');
    expect(blockers).toEqual([]);
  });

  it('blocks on a sibling group conflict', () => {
    const { blockers } = reconcileStudentProfileFields({
      canonicalProfileId: 'canonical-1',
      profiles: [
        source('canonical-1', { siblingGroupId: 'sib-a' }),
        source('legacy-1', { siblingGroupId: 'sib-b' }),
      ],
    });
    expect(blockers).toContainEqual(expect.objectContaining({ code: 'SIBLING_GROUP_CONFLICT' }));
  });

  it('does not block when only one profile declares a sibling group', () => {
    const { canonicalPatch, blockers } = reconcileStudentProfileFields({
      canonicalProfileId: 'canonical-1',
      profiles: [source('canonical-1', {}), source('legacy-1', { siblingGroupId: 'sib-a' })],
    });
    expect(blockers).toEqual([]);
    expect(canonicalPatch.siblingGroupId).toBe('sib-a');
  });

  it('retains the canonical face image and fingerprints alternates for review without deleting them', () => {
    const { canonicalPatch, decisions } = reconcileStudentProfileFields({
      canonicalProfileId: 'canonical-1',
      profiles: [
        source('canonical-1', { faceImageStoragePath: 'faces/canonical-1.jpg' }),
        source('legacy-1', { faceImageStoragePath: 'faces/legacy-1.jpg' }),
      ],
    });
    expect(canonicalPatch.faceImageStoragePath).toBeUndefined();
    const decision = decisions.find((d) => d.fieldPath === 'faceImageStoragePath');
    expect(decision?.action).toBe('retain_alternative_fingerprint');
    expect(decision?.sourceFingerprints['legacy-1']).toBeTruthy();
  });

  it('produces the sorted union of legacyProfileIds across all merged profiles plus their own ids', () => {
    const { canonicalPatch } = reconcileStudentProfileFields({
      canonicalProfileId: 'canonical-1',
      profiles: [
        source('canonical-1', { legacyProfileIds: ['already-merged-1'] }),
        source('legacy-2', { legacyProfileIds: [] }),
      ],
    });
    expect(canonicalPatch.legacyProfileIds).toEqual(['already-merged-1', 'legacy-2']);
  });

  it('preserves legacy courseJoins as corroborating metadata without treating it as authoritative or blocking', () => {
    const { canonicalPatch, blockers } = reconcileStudentProfileFields({
      canonicalProfileId: 'canonical-1',
      profiles: [
        source('canonical-1', { courseJoins: [{ classId: 'c-1', joinedAt: '2026-01-01' }] }),
        source('legacy-1', { courseJoins: [{ classId: 'c-2', joinedAt: '2026-02-01' }] }),
      ],
    });
    expect(blockers).toEqual([]);
    expect(canonicalPatch.courseJoins).toEqual([
      { classId: 'c-1', joinedAt: '2026-01-01' },
      { classId: 'c-2', joinedAt: '2026-02-01' },
    ]);
  });

  it('is deterministic under shuffled profile order', () => {
    const profiles = [
      source('canonical-1', { createdAt: '2026-03-01T00:00:00.000Z' }),
      source('legacy-1', { createdAt: '2026-01-15T00:00:00.000Z' }),
      source('legacy-2', { createdAt: '2026-02-01T00:00:00.000Z' }),
    ];
    const a = reconcileStudentProfileFields({ canonicalProfileId: 'canonical-1', profiles });
    const b = reconcileStudentProfileFields({ canonicalProfileId: 'canonical-1', profiles: [...profiles].reverse() });
    expect(a).toEqual(b);
  });
});
