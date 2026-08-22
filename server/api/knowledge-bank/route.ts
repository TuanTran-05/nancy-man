import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import { handleCorsPreflight } from '../lib/http/cors.js';
import { sendApiError } from '../lib/http/helpers.js';
import { handleUpload } from './handlers/upload.js';
import {
  handleUploadPrintRequest,
  handlePrintRequestFile,
} from './handlers/printRequests.js';
import { handleUploadProfileImage } from './handlers/profileImage.js';
import {
  handleUploadStudentFace,
  handleStudentFaceImage,
  handleStudentFaceUrl,
} from './handlers/studentFace.js';
import { handleDownload } from './handlers/download.js';
import { handleDelete } from './handlers/delete.js';
import { getDb } from '../lib/auth/verifyAuth.js';
import { guardStudentIdentityRouteMutation } from '../lib/maintenance/studentIdentityRouteGuard.js';

// bodyParser must be off so formidable can parse multipart uploads
export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req: ApiRequest, res: ApiResponse) {
  try {
    if (handleCorsPreflight(req, res)) return;

    const action = req.query.action as string;
    // Express maps DELETE /knowledge-bank/:id to the document id for backwards
    // compatibility.  The maintenance inventory classifies the operation by
    // its logical action, not by an arbitrary document id.
    const maintenanceAction =
      req.method === 'DELETE' && action && action !== 'upload' && action !== 'download'
        ? 'delete'
        : action;

    if (
      await guardStudentIdentityRouteMutation(getDb, res, {
        surface: 'student_face',
        action: maintenanceAction,
        req,
      })
    )
      return;

    switch (action) {
      case 'upload':
        return await handleUpload(req, res);
      case 'upload-print-request':
        return await handleUploadPrintRequest(req, res);
      case 'print-request-file':
        return await handlePrintRequestFile(req, res);
      case 'upload-profile-image':
        return await handleUploadProfileImage(req, res);
      case 'upload-student-face':
        return await handleUploadStudentFace(req, res);
      case 'student-face-image':
        return await handleStudentFaceImage(req, res);
      case 'student-face-url':
        return await handleStudentFaceUrl(req, res);
      case 'download':
        return await handleDownload(req, res);
      case 'delete':
        return await handleDelete(req, res);
      default:
        // Treat unknown action as a document ID for DELETE requests
        if (req.method === 'DELETE' && action && action !== 'upload' && action !== 'download') {
          req.query.id = action;
          return await handleDelete(req, res);
        }
        return res.status(404).json({ success: false, error: 'Unknown action' });
    }
  } catch (err) {
    console.error(`[knowledge-bank/${req.query.action}] Unhandled error:`, err);
    return sendApiError(res, err, 'Internal server error');
  }
}
