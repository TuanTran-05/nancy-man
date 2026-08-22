import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import { randomUUID } from 'crypto';
import { verifyAuthToken } from '../../lib/auth/verifyAuth.js';
import {
  MAX_IMAGE_SIZE,
  parseSingleFileForm,
  getExt,
  sanitizeFilename,
  saveImageFile,
  formatClientError,
} from './utils.js';

export async function handleUploadProfileImage(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST')
    return res.status(405).json({ success: false, error: 'Method not allowed' });

  const user = await verifyAuthToken(req, res);
  if (!user) return;

  try {
    const { uploadedFile } = await parseSingleFileForm(req, MAX_IMAGE_SIZE);
    if (!uploadedFile) {
      return res.status(400).json({ success: false, error: 'Missing image file' });
    }

    const filename = uploadedFile.originalFilename || 'avatar.jpg';
    const ext = getExt(filename) || 'jpg';
    const storagePath = `avatars/${user.uid}/${Date.now()}_${randomUUID()}_${sanitizeFilename(
      filename,
      ext
    )}`;
    const result = await saveImageFile(uploadedFile, storagePath, ext);
    return res.status(201).json({ success: true, ...result });
  } catch (err: any) {
    console.error('[KnowledgeBank] Profile image upload error:', err);
    const clientError = formatClientError(err, 'Failed to upload image', 'Image too large');
    return res.status(clientError.statusCode).json({
      success: false,
      error: clientError.error,
    });
  }
}
