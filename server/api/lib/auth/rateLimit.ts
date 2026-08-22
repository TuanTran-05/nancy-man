import type { DocumentStore } from '@/server/db/documentStore.js';
import { FieldValue } from '@/server/db/documentStore.js';
import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import { getClientIp } from '../logging/auditLog.js';

/**
 * Fixed-window rate limiter backed by DocumentStore.
 * Uses the `_rate_limits` collection (Admin SDK only, no DocumentStore rules needed).
 */

export interface RateLimitOptions {
  failClosed?: boolean;
  failOpen?: boolean;
}

export async function checkRateLimit(
  db: DocumentStore,
  key: string,
  maxAttempts: number,
  windowMs: number,
  options?: RateLimitOptions
): Promise<{ allowed: boolean; remaining: number }> {
  if (options?.failOpen && options?.failClosed) {
    throw new Error('Rate limit options conflict: both failOpen and failClosed are true');
  }

  try {
    const ref = db.collection('_rate_limits').doc(key);
    const result = await db.runTransaction(async (tx) => {
      const now = Date.now();
      const snap = await tx.get(ref);

      if (!snap.exists) {
        tx.set(ref, { count: 1, windowStart: now, updatedAt: now });
        return { allowed: true, remaining: maxAttempts - 1 };
      }

      const data = snap.data()!;
      const windowStart = data.windowStart as number;

      if (now - windowStart > windowMs) {
        tx.set(ref, { count: 1, windowStart: now, updatedAt: now });
        return { allowed: true, remaining: maxAttempts - 1 };
      }

      const currentCount = data.count as number;
      if (currentCount >= maxAttempts) {
        return { allowed: false, remaining: 0 };
      }

      tx.update(ref, { count: FieldValue.increment(1), updatedAt: now });
      return { allowed: true, remaining: maxAttempts - currentCount - 1 };
    });
    return result;
  } catch (err: any) {
    if (err?.message === 'Rate limit options conflict: both failOpen and failClosed are true') {
      throw err;
    }
    if (options?.failOpen || options?.failClosed === false) {
      return { allowed: true, remaining: maxAttempts };
    }
    return { allowed: false, remaining: 0 };
  }
}

export async function enforceRateLimit(
  db: DocumentStore,
  req: ApiRequest,
  res: ApiResponse,
  options: {
    scope: string;
    uid: string;
    maxAttempts: number;
    windowMs: number;
    action?: string;
    message?: string;
    failClosed?: boolean;
  }
): Promise<boolean> {
  const suffix = options.action ? `:${options.action}` : '';
  const { allowed } = await checkRateLimit(
    db,
    `${options.scope}:${getClientIp(req)}:${options.uid}${suffix}`,
    options.maxAttempts,
    options.windowMs,
    { failClosed: options.failClosed ?? true }
  );
  if (allowed) return true;
  res.status(429).json({
    success: false,
    errorCode: 'rate_limited',
    error: options.message || 'Too many requests',
  });
  return false;
}

/**
 * Check if a record exists within the given time window.
 * Used for notification deduplication (no counter, just existence check).
 */
export async function isDuplicateWithinWindow(
  db: DocumentStore,
  key: string,
  windowMs: number
): Promise<boolean> {
  const ref = db.collection('_rate_limits').doc(key);

  try {
    const snap = await ref.get();
    if (!snap.exists) return false;

    const data = snap.data()!;
    const windowStart = data.windowStart as number;
    return Date.now() - windowStart < windowMs;
  } catch {
    return false;
  }
}

/**
 * Create or reset a record in the rate_limits collection.
 * Used after successfully sending a notification to mark it as sent.
 */
export async function markRecord(db: DocumentStore, key: string, _windowMs: number): Promise<void> {
  const ref = db.collection('_rate_limits').doc(key);
  const now = Date.now();

  try {
    await ref.set({ count: 1, windowStart: now, updatedAt: now });
  } catch {
    // Non-critical — worst case duplicate notification gets through
  }
}
