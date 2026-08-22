import React from 'react';
import { motion } from 'framer-motion';
import { Bell, Clock, X } from 'lucide-react';
import { ModalPortal } from '../../../components/common/ModalPortal';
import { Notification as AppNotification } from '../../../types';

interface NotificationDetailModalProps {
  notification: AppNotification | null;
  onClose: () => void;
  formatDateLabel: (value?: string | number | Date | null, pattern?: string) => string;
  closeLabel: string;
  detailsLabel: string;
}

export function NotificationDetailModal({
  notification,
  onClose,
  formatDateLabel,
  closeLabel,
  detailsLabel,
}: NotificationDetailModalProps) {
  if (!notification) return null;

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-[1000] flex px-4 pb-4 pt-16 lg:items-center lg:p-4 bg-slate-900/40 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          transition={{ type: 'spring', duration: 0.5, bounce: 0.3 }}
          className="mx-auto w-full max-w-lg overflow-hidden rounded-[24px] bg-white dark:bg-slate-800 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.2)]"
        >
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-700/50 px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-orange-100 dark:bg-orange-500/20 text-orange-600 dark:text-orange-400">
                <Bell className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  {detailsLabel}
                </h3>
              </div>
            </div>
            <button
              onClick={onClose}
              className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-600 dark:hover:text-slate-300"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="p-6">
            <p className="text-lg font-bold text-slate-900 dark:text-slate-100 break-words whitespace-pre-wrap">
              {notification.title}
            </p>
            <div className="mt-2 text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" />
              {formatDateLabel(notification.createdAt, 'HH:mm - dd/MM/yyyy')}
            </div>
            <div className="mt-4 rounded-xl bg-slate-50 dark:bg-slate-900 px-5 py-4 text-sm text-slate-700 dark:text-slate-200 leading-relaxed whitespace-pre-wrap break-words border border-slate-100 dark:border-slate-800">
              {notification.message}
            </div>
            <div className="mt-6 flex justify-end">
              <button
                onClick={onClose}
                className="rounded-xl bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700"
              >
                {closeLabel}
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </ModalPortal>
  );
}
