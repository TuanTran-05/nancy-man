import React, { useState } from 'react';
import { motion } from 'framer-motion';
import {
  X,
  Lock as LockIcon,
  Eye,
  EyeOff,
  CheckCircle,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';
import { auth } from '../../lib/auth/sessionAuth';
import { UserProfile } from '../../types';
import { validatePasswordStrength } from '../../lib/auth/passwordValidation';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { apiRequest } from '../../lib/api/apiClient';
import { useLanguage } from '../../lib/i18n/useLanguage';
import { ModalPortal } from '../common/ModalPortal';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  profile: UserProfile;
  isForced?: boolean;
}

export function ChangePasswordModal({ isOpen, onClose, profile, isForced = false }: Props) {
  useBodyScrollLock(isOpen);
  const { t } = useLanguage();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (!currentPassword || !newPassword || !confirmPassword) {
      setError(t.changePasswordModal.fillAllFields);
      return;
    }

    if (newPassword !== confirmPassword) {
      setError(t.changePasswordModal.passwordMismatch);
      return;
    }

    const pwValidation = validatePasswordStrength(newPassword);
    if (!pwValidation.valid) {
      setError(pwValidation.error!);
      return;
    }

    setIsSubmitting(true);

    try {
      if (
        profile.role === 'teacher' ||
        profile.role === 'admin' ||
        profile.role === 'accounting' ||
        profile.role === 'office'
      ) {
        const user = auth.currentUser;
        if (!user || !user.email) {
          throw new Error(t.changePasswordModal.cannotVerifyUser);
        }

        try {
          await apiRequest('/api/v1/auth/verify-current-password', {
            method: 'POST',
            body: { currentPassword },
          });
        } catch (authErr: any) {
          if (
            authErr.code === 'auth/wrong-password' ||
            authErr.code === 'auth/invalid-credential'
          ) {
            throw new Error(t.changePasswordModal.wrongCurrentPassword, { cause: authErr });
          }
          throw authErr;
        }

        await apiRequest('/api/v1/auth/change-password', {
          method: 'POST',
          body: { currentPassword, newPassword },
        });

        // Also if they have forcePasswordChange in users collection
        if (
          profile.role === 'teacher' ||
          profile.role === 'accounting' ||
          profile.role === 'admin' ||
          profile.role === 'office'
        ) {
          await apiRequest('/api/v1/auth/change-password-complete', {
            method: 'POST',
          });
        }
      } else {
        if (!profile.studentId) {
          throw new Error(t.changePasswordModal.studentNotFound);
        }

        const isParent = profile.role === 'parent';

        // Verify current password via server API (hash/salt never sent to client)
        const verifyResp = await fetch('/api/v1/auth/verify-current-password', {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
          },
          body: JSON.stringify({
            studentDocId: profile.studentId,
            type: isParent ? 'parent' : 'student',
            currentPassword,
          }),
        });
        const verifyData = await verifyResp.json();
        if (!verifyResp.ok) {
          throw new Error(verifyData.error || t.changePasswordModal.cannotVerifyPassword);
        }
        if (!verifyData.valid) {
          setError(t.changePasswordModal.wrongCurrentPassword);
          setIsSubmitting(false);
          return;
        }

        // Server-side hashing — password never written directly from client
        const response = await fetch('/api/v1/auth/reset', {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
          },
          body: JSON.stringify({
            studentDocId: profile.studentId,
            type: isParent ? 'parent' : 'student',
            newPassword: newPassword,
          }),
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.error || 'Password reset failed');
        }
      }

      setSuccess(true);
      setTimeout(() => {
        onClose();
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        setSuccess(false);
      }, 2000);
    } catch (err: any) {
      console.error('Error changing password:', err);
      if (err.message && err.message.includes('permission')) {
        setError(t.changePasswordModal.noPermission);
      } else {
        setError(
          t.changePasswordModal.changeError + (err.message || t.changePasswordModal.tryAgain)
        );
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden"
        >
          <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-blue-600 text-white">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-white/20 rounded-xl">
                <LockIcon className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold">{t.changePasswordModal.changePassword}</h2>
                <p className="text-blue-100 text-xs">
                  {isForced
                    ? t.changePasswordModal.mustChangePassword
                    : t.changePasswordModal.accountSecurity}
                </p>
              </div>
            </div>
            {!isForced && (
              <button
                type="button"
                aria-label={t.changePasswordModal.close}
                onClick={onClose}
                className="p-2 hover:bg-white/20 rounded-full transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>

          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            {error && (
              <div className="p-3 bg-red-50 text-red-600 rounded-xl text-sm flex items-start gap-2">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {success && (
              <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl text-sm flex items-start gap-2">
                <CheckCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{t.changePasswordModal.successMessage}</span>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                {t.changePasswordModal.currentPassword}
              </label>
              <div className="relative">
                <input
                  type={showCurrent ? 'text' : 'password'}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="w-full pl-4 pr-10 py-2.5 bg-slate-50 border border-slate-100 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                  placeholder={t.changePasswordModal.currentPasswordPlaceholder}
                />
                <button
                  type="button"
                  onClick={() => setShowCurrent(!showCurrent)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                {t.changePasswordModal.newPassword}
              </label>
              <div className="relative">
                <input
                  type={showNew ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full pl-4 pr-10 py-2.5 bg-slate-50 border border-slate-100 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                  placeholder={t.changePasswordModal.newPasswordPlaceholder}
                />
                <button
                  type="button"
                  onClick={() => setShowNew(!showNew)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                {t.changePasswordModal.confirmNewPassword}
              </label>
              <div className="relative">
                <input
                  type={showConfirm ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full pl-4 pr-10 py-2.5 bg-slate-50 border border-slate-100 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                  placeholder={t.changePasswordModal.confirmNewPlaceholder}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm(!showConfirm)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="pt-4 flex space-x-3 border-t border-slate-100">
              {!isForced && (
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 px-4 py-2.5 border border-slate-100 text-slate-600 rounded-xl font-medium hover:bg-slate-50 transition-colors"
                >
                  {t.changePasswordModal.cancel}
                </button>
              )}
              <button
                type="submit"
                disabled={isSubmitting || success}
                className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-sm shadow-blue-200"
              >
                {isSubmitting ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    {t.changePasswordModal.processing}
                  </>
                ) : (
                  t.changePasswordModal.changePassword
                )}
              </button>
            </div>
          </form>
        </motion.div>
      </div>
    </ModalPortal>
  );
}
