import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import { handleCorsPreflight } from '../lib/http/cors.js';
import { handleReadObject } from './readObject.js';

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (handleCorsPreflight(req, res)) return;
  if (req.query.action === 'read') return await handleReadObject(req, res);
  return res.status(404).json({ success: false, error: 'Unknown files action' });
}
