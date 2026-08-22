import type { DocumentStore } from '@/server/db/documentStore.js';
export const ADMIN_SESSION_TTL_MS = 15 * 60 * 1000; // 15 minutes
export const ADMIN_SESSIONS_COLLECTION = 'zalo_bot_admin_sessions';

export type AdminChatSession = {
  staffId: string;
  lastStudentId?: string | null;
  lastTeacherId?: string | null;
  lastClassId?: string | null;
  lastPeriod?: string | null;
  pendingCandidateIds?: string[];
  updatedAt: string;
  expiresAt: string;
};

/**
 * Retrieves the active ID-only session for an admin staff member.
 * Returns null if no session exists or if it has expired.
 */
export async function getAdminSession(
  db: DocumentStore,
  staffId: string,
  now = new Date()
): Promise<AdminChatSession | null> {
  if (!staffId || !staffId.trim()) return null;

  try {
    const snap = await db.collection(ADMIN_SESSIONS_COLLECTION).doc(staffId.trim()).get();
    if (!snap.exists) return null;

    const data = snap.data() as AdminChatSession;
    if (!data || !data.expiresAt) return null;

    const expiresAtMs = Date.parse(data.expiresAt);
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= now.getTime()) {
      return null;
    }

    return {
      staffId: data.staffId || staffId,
      lastStudentId: data.lastStudentId ?? null,
      lastTeacherId: data.lastTeacherId ?? null,
      lastClassId: data.lastClassId ?? null,
      lastPeriod: data.lastPeriod ?? null,
      pendingCandidateIds: Array.isArray(data.pendingCandidateIds)
        ? data.pendingCandidateIds.filter((id) => typeof id === 'string' && id.trim()).slice(0, 10)
        : [],
      updatedAt: data.updatedAt,
      expiresAt: data.expiresAt,
    };
  } catch {
    return null;
  }
}

/**
 * Saves or updates an ID-only admin chat session.
 * Enforces TTL and strips any PII / money values before persisting.
 */
export async function saveAdminSession(
  db: DocumentStore,
  params: {
    staffId: string;
    lastStudentId?: string | null;
    lastTeacherId?: string | null;
    lastClassId?: string | null;
    lastPeriod?: string | null;
    pendingCandidateIds?: string[];
  },
  now = new Date()
): Promise<void> {
  const staffId = params.staffId.trim();
  if (!staffId) return;

  const nowIso = now.toISOString();
  const expiresAtIso = new Date(now.getTime() + ADMIN_SESSION_TTL_MS).toISOString();

  const sessionData: AdminChatSession = {
    staffId,
    lastStudentId: params.lastStudentId ?? null,
    lastTeacherId: params.lastTeacherId ?? null,
    lastClassId: params.lastClassId ?? null,
    lastPeriod: params.lastPeriod ?? null,
    pendingCandidateIds: Array.isArray(params.pendingCandidateIds)
      ? [
          ...new Set(
            params.pendingCandidateIds.filter((id) => typeof id === 'string' && id.trim())
          ),
        ].slice(0, 10)
      : [],
    updatedAt: nowIso,
    expiresAt: expiresAtIso,
  };

  await db.collection(ADMIN_SESSIONS_COLLECTION).doc(staffId).set(sessionData);
}

/**
 * Clears an admin chat session.
 */
export async function clearAdminSession(db: DocumentStore, staffId: string): Promise<void> {
  if (!staffId || !staffId.trim()) return;
  try {
    await db.collection(ADMIN_SESSIONS_COLLECTION).doc(staffId.trim()).delete();
  } catch {
    // Non-blocking cleanup
  }
}

/**
 * Cleans up expired sessions in batches.
 */
export async function cleanupExpiredAdminSessions(
  db: DocumentStore,
  now = new Date()
): Promise<number> {
  const nowIso = now.toISOString();
  const snaps = await db
    .collection(ADMIN_SESSIONS_COLLECTION)
    .where('expiresAt', '<=', nowIso)
    .limit(100)
    .get();

  if (snaps.empty) return 0;

  const batch = db.batch();
  for (const doc of snaps.docs) {
    batch.delete(doc.ref);
  }
  await batch.commit();
  return snaps.size;
}
