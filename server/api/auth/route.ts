import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import { handleCorsPreflight } from '../lib/http/cors.js';
import { sendApiError } from '../lib/http/helpers.js';
import {
  handleAutoCreateProfile,
  handleChangePasswordComplete,
  handleStaffConfig,
  handleSyncLogin,
} from './handlers/staffAuth.js';
import {
  handleApprove,
  handleCreatePasswordRequest,
  handleLogReset,
  handleRejectPasswordReset,
  handleReset,
} from './handlers/passwordManagement.js';
import {
  handleLookupStudent,
  handleMigrateCredentials,
  handleVerifyCredentialMigration,
  handleVerifyCurrentPassword,
  handleVerifyStudentLogin,
} from './handlers/studentAuth.js';
import {
  handleRequestZaloOtp,
  handleResetPasswordZalo,
  handleVerifyZaloOtp,
} from './handlers/zaloOtp.js';
import {
  handleConfirmProfilePhoneChange,
  handleRequestProfilePhoneOtp,
  handleVerifyProfilePhoneOtp,
} from './handlers/profilePhoneOtp.js';
import {
  handleStaffAddEmail,
  handleStaffApproveResetRequest,
  handleStaffCreateAccount,
  handleStaffDeleteAccount,
  handleStaffDeleteBlockedEmail,
  handleStaffForgotPassword,
  handleStaffLoginRateCheck,
  handleStaffRejectResetRequest,
  handleStaffRemoveEmail,
  handleStaffResetPassword,
  handleStaffStandardizeTeacherIds,
  handleStaffUnblockEmail,
} from './handlers/staffAccountManagement.js';
import { handleRetrieveTempPassword } from './handlers/retrieveTempPassword.js';
import { handleVerifyTurnstileLogin } from './handlers/turnstileLogin.js';
import {
  handleChangeStaffPassword,
  handleGoogleCallback,
  handleGoogleLinkStart,
  handleGoogleStart,
  handleSession,
  handleSessionLogin,
  handleSessionLogout,
} from './handlers/sessionAuth.js';
import { handleRequestSmsOtp, handleVerifySmsOtp } from './handlers/smsOtp.js';
import { getDb } from '../lib/auth/verifyAuth.js';
import { guardStudentIdentityRouteMutation } from '../lib/maintenance/studentIdentityRouteGuard.js';

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (handleCorsPreflight(req, res)) return;

  const action = req.query.action as string;

  // Session routes are native VPS infrastructure. They must not pass through
  // the legacy student-record maintenance inventory, which would otherwise
  // classify cookie creation as an unknown student mutation.
  try {
    switch (action) {
      case 'session':
        return await handleSession(req, res);
      case 'session-login':
        return await handleSessionLogin(req, res);
      case 'session-logout':
        return await handleSessionLogout(req, res);
      case 'change-password':
        return await handleChangeStaffPassword(req, res);
      case 'google-start':
        return await handleGoogleStart(req, res);
      case 'google-link-start':
        return await handleGoogleLinkStart(req, res);
      case 'google-callback':
        return await handleGoogleCallback(req, res);
      case 'request-sms-otp':
        return await handleRequestSmsOtp(req, res);
      case 'verify-sms-otp':
        return await handleVerifySmsOtp(req, res);
    }
  } catch (err) {
    console.error(`[Auth/${action}] Session error:`, err);
    return sendApiError(res, err, 'Authentication service unavailable');
  }

  // Credentials belong to the profile that survives a merge, so login and
  // reset paths pause with everything else. Reads are untouched.
  if (
    await guardStudentIdentityRouteMutation(getDb, res, {
      surface: 'student_auth',
      action,
      req,
    })
  )
    return;

  try {
    switch (action) {
      case 'staff-config':
        return await handleStaffConfig(req, res);
      case 'auto-create-profile':
        return await handleAutoCreateProfile(req, res);
      case 'sync-login':
        return await handleSyncLogin(req, res);
      case 'change-password-complete':
        return await handleChangePasswordComplete(req, res);
      case 'create-password-request':
        return await handleCreatePasswordRequest(req, res);
      case 'log-reset':
        return await handleLogReset(req, res);
      case 'approve':
        return await handleApprove(req, res);
      case 'reset':
        return await handleReset(req, res);
      case 'reject-password-reset':
        return await handleRejectPasswordReset(req, res);
      case 'verify-student-login':
        return await handleVerifyStudentLogin(req, res);
      case 'verify-current-password':
        return await handleVerifyCurrentPassword(req, res);
      case 'request-zalo-otp':
        return await handleRequestZaloOtp(req, res);
      case 'verify-zalo-otp':
        return await handleVerifyZaloOtp(req, res);
      case 'reset-password-zalo':
        return await handleResetPasswordZalo(req, res);
      case 'request-profile-phone-otp':
        return await handleRequestProfilePhoneOtp(req, res);
      case 'verify-profile-phone-otp':
        return await handleVerifyProfilePhoneOtp(req, res);
      case 'confirm-profile-phone-change':
        return await handleConfirmProfilePhoneChange(req, res);
      case 'verify-turnstile-login':
        return await handleVerifyTurnstileLogin(req, res);
      case 'staff-login-rate-check':
        return await handleStaffLoginRateCheck(req, res);
      case 'staff-create-account':
        return await handleStaffCreateAccount(req, res);
      case 'staff-forgot-password':
        return await handleStaffForgotPassword(req, res);
      case 'staff-reset-password':
        return await handleStaffResetPassword(req, res);
      case 'staff-approve-reset-request':
        return await handleStaffApproveResetRequest(req, res);
      case 'staff-reject-reset-request':
        return await handleStaffRejectResetRequest(req, res);
      case 'staff-add-email':
        return await handleStaffAddEmail(req, res);
      case 'lookup-student':
        return await handleLookupStudent(req, res);
      case 'staff-remove-email':
        return await handleStaffRemoveEmail(req, res);
      case 'staff-unblock-email':
        return await handleStaffUnblockEmail(req, res);
      case 'staff-delete-account':
        return await handleStaffDeleteAccount(req, res);
      case 'staff-delete-blocked-email':
        return await handleStaffDeleteBlockedEmail(req, res);
      case 'staff-standardize-teacher-ids':
        return await handleStaffStandardizeTeacherIds(req, res);
      case 'migrate-credentials':
        return await handleMigrateCredentials(req, res);
      case 'verify-credential-migration':
        return await handleVerifyCredentialMigration(req, res);
      case 'retrieve-temp-password':
        return await handleRetrieveTempPassword(req, res);
      default:
        return res.status(404).json({ success: false, error: 'Unknown auth action' });
    }
  } catch (err) {
    console.error(`[Auth/${action}] Unhandled error:`, err);
    return sendApiError(res, err, 'Internal server error');
  }
}
