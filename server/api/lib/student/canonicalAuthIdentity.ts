import type { DocumentStore } from '@/server/db/documentStore.js';
import type { CanonicalStudentReadMode } from '../../../../shared/canonicalStudentReadModel.js';
import {
  buildCanonicalReadDiscrepancy,
  recordCanonicalReadDiscrepancies,
} from './canonicalStudentReadControl.js';
import { resolveCanonicalStudentId } from './studentIdentityResolver.js';

/**
 * The single point at which a typed student code or a stored account link
 * becomes the profile an authenticated session speaks for.
 *
 * Two rules, and they differ because the cost of being wrong differs.
 *
 * **Login refuses to guess.** The old selection was
 * `docs.find((d) => d.data().enrollmentStatus === 'active') || docs[0]` — with
 * fifty-nine codes carried by two documents in production, that hands a family
 * whichever half of a merged child happens to still be marked active. It is
 * also the wrong half by construction: promotion writes the new row as
 * `promoted` and leaves the old one `active`. From `canonical_preferred`
 * onwards nothing is selected unless the data says which human it is.
 *
 * **An existing session never gets locked out.** A linked account stores the
 * profile id it was created against, and a merge retires that id. Refusing the
 * session would log a family out with "account revoked", which reads as an
 * accusation for something the center did. So the stored id is resolved
 * forward, and an id that cannot be resolved keeps standing for itself.
 */

export type StudentAuthProfileSelection = {
  /** The profile whose credentials and records answer this request. */
  profileId: string;
  /** What the old heuristic picked. Kept so audit lines name what was typed. */
  legacyProfileId: string;
  /** The resolver's answer, or null when identity could not be established. */
  canonicalProfileId: string | null;
  /** True when the two disagree, i.e. the caller reached a different profile. */
  redirected: boolean;
};

export type StudentAuthProfileCandidate = {
  id: string;
  data: Record<string, unknown>;
};

export type SelectStudentAuthProfileInput = {
  /** The code the caller typed, or a profile id when the caller had one. */
  code: string;
  /** Documents a `students.studentId == code` query returned, in query order. */
  candidates: readonly StudentAuthProfileCandidate[];
  mode: CanonicalStudentReadMode;
  /** Names the shadow-mode log line, e.g. `student_login`. */
  surface: string;
};

/**
 * What the login path did before this module existed.
 *
 * Preserved verbatim rather than improved, because in `legacy_compare` the
 * whole point is that shadow mode changes nothing a user can feel.
 */
function legacySelection(
  candidates: readonly StudentAuthProfileCandidate[]
): StudentAuthProfileCandidate | null {
  const active = candidates.find((candidate) => candidate.data.enrollmentStatus === 'active');
  return active || candidates[0] || null;
}

/**
 * The canonical profile a typed code names, or null when nothing says.
 *
 * Two passes, and the second is the one that matters. The registry answers
 * directly when it has been populated; until then the only record of the
 * fifty-nine duplicated codes is the alias written per *profile*, which a
 * code lookup cannot see. Resolving each document that carries the code and
 * checking that they converge is what turns "two owners, refuse" into "two
 * documents, one child, and a human already said so".
 *
 * Convergence is not a heuristic: it asks the alias records, and it gives up
 * the moment they disagree. Nothing here inspects `enrollmentStatus`.
 */
async function resolveAuthCode(
  db: DocumentStore,
  code: string,
  candidates: readonly StudentAuthProfileCandidate[]
): Promise<string | null> {
  const direct = await resolveCanonicalStudentId(db, code)
    .then((resolution) => resolution.canonicalProfileId)
    .catch(() => null);
  if (direct) return direct;

  const resolved = await Promise.all(
    candidates.map((candidate) =>
      resolveCanonicalStudentId(db, candidate.id)
        .then((resolution) => resolution.canonicalProfileId)
        .catch(() => null)
    )
  );
  const distinct = [...new Set(resolved.filter((id): id is string => id !== null))];
  return distinct.length === 1 ? distinct[0] : null;
}

export async function selectStudentAuthProfile(
  db: DocumentStore,
  input: SelectStudentAuthProfileInput
): Promise<StudentAuthProfileSelection | null> {
  const legacy = legacySelection(input.candidates);

  const canonicalProfileId = await resolveAuthCode(db, input.code, input.candidates);

  if (input.mode === 'legacy_compare') {
    if (!legacy) return null;
    if (canonicalProfileId && canonicalProfileId !== legacy.id) {
      recordCanonicalReadDiscrepancies([
        buildCanonicalReadDiscrepancy({
          surface: input.surface,
          reasonCode: 'LEGACY_PHYSICAL_DUPLICATE',
          canonicalProfileIds: [canonicalProfileId],
          legacyProfileIds: input.candidates.map((candidate) => candidate.id),
          legacyCount: input.candidates.length,
          canonicalCount: 1,
        }),
      ]);
    }
    return {
      profileId: legacy.id,
      legacyProfileId: legacy.id,
      canonicalProfileId,
      // False on purpose: in this mode the caller reached the profile the old
      // code would have reached, whatever the resolver thinks of it.
      redirected: false,
    };
  }

  if (!canonicalProfileId) return null;
  return {
    profileId: canonicalProfileId,
    legacyProfileId: legacy ? legacy.id : canonicalProfileId,
    canonicalProfileId,
    redirected: Boolean(legacy) && legacy!.id !== canonicalProfileId,
  };
}

/**
 * The profile a linked student or parent account speaks for.
 *
 * Applied after the token binding has already been checked against the stored
 * id, so this changes which records the session reads, never who it is.
 */
export async function resolveLinkedStudentProfileId(
  db: DocumentStore,
  storedStudentId: string
): Promise<string> {
  if (!storedStudentId) return storedStudentId;
  try {
    const resolution = await resolveCanonicalStudentId(db, storedStudentId);
    return resolution.canonicalProfileId;
  } catch {
    return storedStudentId;
  }
}
