import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldAlert, Mail, LogOut } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useLanguage } from '../../lib/i18n/useLanguage';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { ModalPortal } from '../common/ModalPortal';

export const BlockedModal: React.FC = () => {
  const { blockedInfo, setBlockedInfo, signOut } = useAuth();
  const [countdown, setCountdown] = useState(30);
  const { t } = useLanguage();
  const prevBlockedRef = useRef<boolean>(false);
  useBodyScrollLock(!!blockedInfo);

  // Reset countdown every time blockedInfo transitions from null → value
  useEffect(() => {
    const isBlocked = !!blockedInfo;
    if (isBlocked && !prevBlockedRef.current) {
      setCountdown(30);
    }
    prevBlockedRef.current = isBlocked;
  }, [blockedInfo]);

  const handleImmediateSignOut = useCallback(async () => {
    setBlockedInfo(null);
    setCountdown(30);
    await signOut();
  }, [signOut, setBlockedInfo]);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (blockedInfo && countdown > 0) {
      timer = setInterval(() => {
        setCountdown((prev) => prev - 1);
      }, 1000);
    } else if (countdown === 0 && blockedInfo) {
      void handleImmediateSignOut();
    }
    return () => clearInterval(timer);
  }, [blockedInfo, countdown, handleImmediateSignOut]);

  if (!blockedInfo) return null;

  return (
    <ModalPortal>
      <AnimatePresence>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[1200] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm"
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            className="bg-surface rounded-3xl shadow-2xl dark:shadow-black/30 max-w-md w-full overflow-hidden"
          >
            <div className="bg-red-600 p-8 flex flex-col items-center text-center text-white">
              <div className="w-20 h-20 bg-white/20 rounded-full flex items-center justify-center mb-4 backdrop-blur-md">
                <ShieldAlert className="w-10 h-10 text-white" />
              </div>
              <h2 className="text-2xl font-bold mb-2">
                {blockedInfo.reason === 'revoked'
                  ? t.blockedModal.revokedTitle
                  : blockedInfo.reason === 'dropped_student'
                    ? t.blockedModal.disabledTitle
                    : blockedInfo.reason === 'dropped_parent'
                      ? t.blockedModal.disabledTitle
                      : t.blockedModal.googleNotReady}
              </h2>
              <p className="text-red-100 text-sm">
                {blockedInfo.reason === 'revoked'
                  ? t.blockedModal.revokedDesc
                  : blockedInfo.reason === 'dropped_student'
                    ? t.blockedModal.disabledDropoutDesc
                    : blockedInfo.reason === 'dropped_parent'
                      ? t.blockedModal.disabled30DaysDesc
                      : t.blockedModal.googleFirstLogin}
              </p>
            </div>

            <div className="p-8 space-y-6">
              <div className="bg-surface-alt rounded-2xl p-4 border border-border-light">
                {blockedInfo.email && (
                  <div className="flex items-center space-x-3 text-muted mb-3">
                    <Mail className="w-4 h-4" />
                    <span className="text-sm font-medium truncate">{blockedInfo.email}</span>
                  </div>
                )}
                <p className="text-sm text-muted leading-relaxed">
                  {blockedInfo.reason === 'revoked'
                    ? t.blockedModal.revokedFull
                    : blockedInfo.reason === 'dropped_student'
                      ? t.blockedModal.disabledDropoutFull
                      : blockedInfo.reason === 'dropped_parent'
                        ? t.blockedModal.disabled30DaysFull
                        : t.blockedModal.googleFirstLoginFull}
                </p>
                <p className="text-blue-600 font-bold mt-2 text-sm">
                  tt1068996@gmail.com (Mr. TuanTran)
                </p>
              </div>

              <div className="flex flex-col items-center space-y-4">
                <div className="w-full bg-surface-alt h-2 rounded-full overflow-hidden">
                  <motion.div
                    key={blockedInfo.email + blockedInfo.reason}
                    initial={{ width: '100%' }}
                    animate={{ width: '0%' }}
                    transition={{ duration: 30, ease: 'linear' }}
                    className="bg-red-500 h-full"
                  />
                </div>
                <p className="text-xs text-subtle font-medium">
                  {t.blockedModal.autoLogout.replace('{count}', String(countdown))}
                </p>
              </div>

              <button
                onClick={handleImmediateSignOut}
                className="w-full flex items-center justify-center space-x-2 bg-heading text-white py-4 rounded-2xl font-bold hover:opacity-90 transition-all active:scale-[0.98]"
              >
                <LogOut className="w-5 h-5" />
                <span>{t.blockedModal.logoutNow}</span>
              </button>
            </div>
          </motion.div>
        </motion.div>
      </AnimatePresence>
    </ModalPortal>
  );
};
