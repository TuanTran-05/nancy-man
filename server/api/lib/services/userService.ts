import type { DocumentStore } from '@/server/db/documentStore.js';

/**
 * Get a user's role from the users collection.
 */
export async function getUserRole(db: DocumentStore, uid: string): Promise<string> {
  const snap = await db.collection('users').doc(uid).get();
  return String(snap.data()?.role || '');
}
