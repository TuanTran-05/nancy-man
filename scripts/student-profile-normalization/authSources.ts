import { normalizeInstantForCanonicalJson, sha256 } from './canonicalJson.js';

/**
 * Metadata-only views of the authentication surface.
 *
 * Every artifact this migration produces — plan, manifest, report, journal,
 * log — is written to disk, reviewed by humans, and kept as evidence. So the
 * planner is never given the credential material in the first place: these
 * summarizers are the only door between a raw credential document and the rest
 * of the engine, and they emit presence, version, timestamp, and a
 * non-reversible fingerprint. Nothing downstream can leak what it never saw.
 *
 * Credential *choice* is therefore made by comparing fingerprints, never by
 * comparing or verifying secrets.
 */

/** Fields whose values must never leave this module. */
const SECRET_FIELDS = [
  'loginPasswordSalt',
  'loginPasswordHash',
  'parentPasswordSalt',
  'parentPasswordHash',
] as const;

/**
 * Domain separator. Keeps these fingerprints from matching a digest of the
 * same material produced anywhere else in the system.
 */
const FINGERPRINT_DOMAIN = 'student-credential-material-v1';

export type StudentCredentialMetadata = {
  profileId: string;
  exists: boolean;
  hasStudentPassword: boolean;
  hasParentPassword: boolean;
  studentPasswordVersion: number | null;
  parentPasswordVersion: number | null;
  updatedAt: string | null;
  /** Null when no document exists; otherwise a non-reversible digest. */
  materialFingerprint: string | null;
};

export type LinkedUserRole = 'student' | 'parent' | 'unknown';

export type LinkedUserMetadata = {
  userId: string;
  role: LinkedUserRole;
  /** Profile named by the document id prefix, when the prefix is recognized. */
  idProfileId: string | null;
  /** Profile named by the `studentId` field. */
  fieldProfileId: string | null;
  /**
   * False when the id and the field name different profiles. Produced by
   * earlier partial data fixes that repointed the field but could not rename
   * the document, so both must be planned, not just the one that matched a
   * field query.
   */
  idFieldAgree: boolean;
  isRevoked: boolean;
};

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeUpdatedAt(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  return normalizeInstantForCanonicalJson(value);
}

export function summarizeStudentCredential(
  profileId: string,
  raw: Record<string, unknown> | null | undefined
): StudentCredentialMetadata {
  if (!raw) {
    return {
      profileId,
      exists: false,
      hasStudentPassword: false,
      hasParentPassword: false,
      studentPasswordVersion: null,
      parentPasswordVersion: null,
      updatedAt: null,
      materialFingerprint: null,
    };
  }

  const hasStudentPassword = str(raw.loginPasswordHash) !== '' && str(raw.loginPasswordSalt) !== '';
  const hasParentPassword =
    str(raw.parentPasswordHash) !== '' && str(raw.parentPasswordSalt) !== '';

  // Digest only the declared secret fields, in a fixed order. Anything else in
  // the document — including a reset token an older schema might have left
  // behind — is excluded rather than hashed, so no unexpected field can travel
  // out of here inside a digest input we later decide to log.
  const material = SECRET_FIELDS.map((field) => `${field}=${str(raw[field])}`).join('|');

  return {
    profileId,
    exists: true,
    hasStudentPassword,
    hasParentPassword,
    studentPasswordVersion:
      typeof raw.passwordVersion === 'number' ? raw.passwordVersion : null,
    parentPasswordVersion:
      typeof raw.parentPasswordVersion === 'number' ? raw.parentPasswordVersion : null,
    updatedAt: normalizeUpdatedAt(raw.updatedAt),
    materialFingerprint: sha256(`${FINGERPRINT_DOMAIN}|${material}`),
  };
}

/**
 * Login accounts are addressed by document id (`student:<profileId>`,
 * `parent:<profileId>`) as well as by a `studentId` field, and the two can
 * disagree. A role this function does not recognize is reported as `unknown`
 * rather than guessed — the caller turns that into a blocker, because silently
 * ignoring an account is how a person loses their login.
 */
export function summarizeLinkedUser(
  userId: string,
  raw: Record<string, unknown> | null | undefined
): LinkedUserMetadata {
  const data = raw ?? {};
  const separator = userId.indexOf(':');
  const prefix = separator > 0 ? userId.slice(0, separator) : '';
  const role: LinkedUserRole =
    prefix === 'student' || prefix === 'parent' ? prefix : 'unknown';
  const idProfileId = role === 'unknown' ? null : userId.slice(separator + 1) || null;
  const fieldProfileId = str(data.studentId) || null;

  return {
    userId,
    role,
    idProfileId,
    fieldProfileId,
    idFieldAgree: idProfileId !== null && idProfileId === fieldProfileId,
    isRevoked: data.isRevoked === true,
  };
}
