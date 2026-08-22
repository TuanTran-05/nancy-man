import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import { getDb, verifyAuthToken } from '../../lib/auth/verifyAuth.js';

export async function handleRetrieveTempPassword(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  // Restrict to admins only for maximum security
  const adminUser = await verifyAuthToken(req, res, ['admin']);
  if (!adminUser) return;

  const { token } = req.body || {};
  if (!token || typeof token !== 'string') {
    return res.status(400).json({ success: false, error: 'Missing retrieval token' });
  }

  try {
    const db = getDb();
    const docRef = db.collection('_temp_password_retrievals').doc(token);

    // Use transaction to ensure atomic read and immediate delete
    const result = await db.runTransaction(async (transaction) => {
      const doc = await transaction.get(docRef);
      if (!doc.exists) return null;

      const data = doc.data();
      const expiresAt = new Date(data?.expiresAt || 0).getTime();

      if (Date.now() > expiresAt) {
        transaction.delete(docRef); // Clean up expired
        return null;
      }

      // Delete immediately upon retrieve (burn on read)
      transaction.delete(docRef);

      return data?.tempPassword || null;
    });

    if (!result) {
      return res.status(410).json({
        success: false,
        error: 'Retrieval token is invalid, expired, or has already been used.',
      });
    }

    return res.status(200).json({
      success: true,
      tempPassword: result,
    });
  } catch (err) {
    console.error('[RetrieveTempPassword] Error:', err);
    return res.status(500).json({
      success: false,
      errorCode: 'internal_error',
      error: 'Failed to retrieve password',
    });
  }
}
