import React, { useState, useEffect, useMemo } from 'react';
import toast from 'react-hot-toast';
import { auth } from '../../lib/auth/sessionAuth';
import { apiRequest } from '../../lib/api/apiClient';
import { PasswordResetRequest } from '../../types';
import { useAuth } from '../../contexts/AuthContext';
import {
  CheckCircle2,
  XCircle,
  Clock,
  Search,
  Filter,
  User,
  Calendar,
  AlertCircle,
  RefreshCw,
  Check,
  X as XIcon,
  Phone,
  Copy,
  ExternalLink,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { format } from 'date-fns';
import { vi } from 'date-fns/locale';
import { ModalPortal } from '../../components/common/ModalPortal';
import { FRONTEND_COLLECTION_LIMIT } from '../../lib/api/readLimits';
import { useLanguage } from '../../lib/i18n/useLanguage';
import { translations } from '../../lib/i18n/translations';
import { readChannel } from '../../lib/api/readApi';
import { FRONTEND_READ_POLL_INTERVAL_MS } from '../../lib/api/frontendReadApi';
import {
  getPasswordResetSnapshot,
  setPasswordResetSnapshot,
  type PasswordResetSnapshotIdentity,
} from '../../lib/password-reset/passwordResetSnapshot';

type ResetStreamState = {
  identityKey: string;
  requests: PasswordResetRequest[];
  loading: boolean;
};

function readStreamState(
  identity: PasswordResetSnapshotIdentity,
  identityKey: string
): ResetStreamState {
  const snapshot = getPasswordResetSnapshot(identity);
  // A missing snapshot is the only case that still deserves the loader; an
  // empty one is a known answer.
  return { identityKey, requests: snapshot || [], loading: snapshot === null };
}

export default function PasswordResetRequests() {
  const { profile } = useAuth();
  const { language } = useLanguage();
  const t = translations[language].passwordResetPage;
  const tCommon = translations[language].common;
  const identity = useMemo(
    () => ({ uid: profile?.uid || '', role: profile?.role || '' }),
    [profile?.uid, profile?.role]
  );
  const identityKey = `${identity.uid} ${identity.role}`;
  const [stream, setStream] = useState<ResetStreamState>(() =>
    readStreamState(identity, identityKey)
  );
  // Derived during render, so an account switch can never paint the previous
  // account's rows — not even for the frame before the effect runs.
  const activeStream =
    stream.identityKey === identityKey ? stream : readStreamState(identity, identityKey);
  const requests = activeStream.requests;
  const loading = activeStream.loading;
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>(
    'pending'
  );
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [showRejectModal, setShowRejectModal] = useState<string | null>(null);
  const [showSuccessModal, setShowSuccessModal] = useState<{
    requestId: string;
    tempPassword: string;
    phoneNumber: string;
    studentName: string;
  } | null>(null);

  useBodyScrollLock(!!showRejectModal || !!showSuccessModal);

  useEffect(() => {
    if (!identity.uid) return;
    let cancelled = false;

    const loadRequests = async () => {
      try {
        const data = await readChannel<{ requests: PasswordResetRequest[] }>(
          'password-reset-requests',
          { limit: FRONTEND_COLLECTION_LIMIT }
        );
        if (cancelled) return;
        const rows = data.requests || [];
        setPasswordResetSnapshot(identity, rows);
        setStream({ identityKey, requests: rows, loading: false });
      } catch (error) {
        if (cancelled) return;
        console.error('Error fetching reset requests through read API:', error);
        setStream((previous) => {
          const base =
            previous.identityKey === identityKey
              ? previous
              : readStreamState(identity, identityKey);
          return { ...base, loading: false };
        });
      }
    };

    void loadRequests();
    const interval = setInterval(() => void loadRequests(), FRONTEND_READ_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [identity, identityKey]);

  const handleApprove = async (request: PasswordResetRequest) => {
    if (processingId) return;
    setProcessingId(request.id);

    try {
      const user = auth.currentUser;
      if (!user) throw new Error('Not authenticated');
      const response = await fetch('/api/v1/auth/approve', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify({
          requestId: request.id,
        }),
      });

      const text = await response.text();
      let data: any;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(text || `Server error (${response.status})`);
      }

      if (!data.success) {
        throw new Error(data.error || 'Failed to approve request');
      }

      setShowSuccessModal({
        requestId: request.id,
        tempPassword: data.tempPassword,
        phoneNumber: request.phoneNumber,
        studentName: request.studentName,
      });
    } catch (err: any) {
      console.error('Approval failed:', err);
      toast.error(t.approveError + err.message);
    } finally {
      setProcessingId(null);
    }
  };

  const handleReject = async (requestId: string) => {
    if (!rejectionReason.trim() || processingId) return;
    setProcessingId(requestId);

    try {
      await apiRequest('/api/v1/auth/reject-password-reset', {
        method: 'POST',
        body: { requestId, reason: rejectionReason },
      });
      setShowRejectModal(null);
      setRejectionReason('');
    } catch (err: any) {
      console.error('Rejection failed:', err);
      toast.error(t.rejectError + err.message);
    } finally {
      setProcessingId(null);
    }
  };

  const filteredRequests = requests.filter((req) => {
    const studentName = req.studentName || '';
    const userId = req.userId || '';
    const matchesSearch =
      studentName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      userId.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'all' || req.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const highlightMatch = (text: string, highlight: string) => {
    if (!text) return <></>;
    if (!highlight.trim()) return <>{text}</>;

    const escapedHighlight = highlight.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const parts = text.split(new RegExp(`(${escapedHighlight})`, 'gi'));

    return (
      <>
        {parts.map((part, i) =>
          part.toLowerCase() === highlight.toLowerCase() ? (
            <span key={i} className="bg-yellow-200 text-heading rounded-sm px-[1px]">
              {part}
            </span>
          ) : (
            <span key={i}>{part}</span>
          )
        )}
      </>
    );
  };

  const formatRequestDate = (dateVal: any) => {
    if (!dateVal) return 'N/A';
    try {
      // Handle PostgreSQL API Timestamp
      if (dateVal && typeof dateVal === 'object' && 'seconds' in dateVal) {
        return format(new Date(dateVal.seconds * 1000), 'HH:mm dd/MM', { locale: vi });
      }
      // Handle ISO string or Date object
      const date = new Date(dateVal);
      if (isNaN(date.getTime())) return 'N/A';
      return format(date, 'HH:mm dd/MM', { locale: vi });
    } catch {
      return 'N/A';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-8 h-8 text-blue-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-heading">{t.title}</h1>
          <p className="text-slate-500 text-sm">{t.description}</p>
        </div>
      </div>

      <div className="bg-surface rounded-2xl shadow-sm dark:shadow-black/20 border border-border-default overflow-hidden">
        <div className="p-4 border-b border-border-light bg-page/50 flex flex-col md:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
            <input
              type="text"
              placeholder={t.searchPlaceholder}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-surface border border-border-default rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all text-sm"
            />
          </div>
          <div className="flex items-center gap-2">
            <Filter className="text-slate-400 w-4 h-4" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="bg-surface border border-border-default rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500 text-sm font-medium text-slate-600"
            >
              <option value="pending">{t.filterPending}</option>
              <option value="approved">{t.filterApproved}</option>
              <option value="rejected">{t.filterRejected}</option>
              <option value="all">{t.filterAll}</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-page/50">
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">
                  {t.colRequester}
                </th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">
                  {t.colType}
                </th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">
                  {t.colMethod}
                </th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">
                  {t.colTime}
                </th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">
                  {t.colStatus}
                </th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">
                  {t.colActions}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredRequests.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-slate-400 italic">
                    {t.noRequests}
                  </td>
                </tr>
              ) : (
                filteredRequests.map((req) => (
                  <tr key={req.id} className="hover:bg-hover/50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center text-slate-600">
                          <User className="w-5 h-5" />
                        </div>
                        <div>
                          <p className="font-bold text-heading">
                            {highlightMatch(req.studentName, searchTerm)}
                          </p>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-slate-500 font-mono">
                              {highlightMatch(req.userId, searchTerm)}
                            </span>
                            <span className="text-slate-300">•</span>
                            <span className="text-xs text-slate-500 flex items-center gap-1">
                              <Phone className="w-3 h-3" />
                              {req.phoneNumber}
                            </span>
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          req.type === 'student'
                            ? 'bg-blue-100 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400'
                            : 'bg-purple-100 dark:bg-purple-500/10 text-purple-700 dark:text-purple-400'
                        }`}
                      >
                        {req.type === 'student' ? t.typeStudent : t.typeParent}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1.5">
                        {req.method === 'otp' ? (
                          <span className="px-2 py-0.5 bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded text-[10px] font-bold">
                            OTP SMS
                          </span>
                        ) : req.method === 'email' ? (
                          <span className="px-2 py-0.5 bg-purple-50 dark:bg-purple-500/10 text-purple-600 dark:text-purple-400 rounded text-[10px] font-bold">
                            Email Link
                          </span>
                        ) : req.method === 'manual_request' ? (
                          <span className="px-2 py-0.5 bg-amber-50 dark:bg-amber-500/10 text-amber-600 rounded text-[10px] font-bold">
                            {t.methodDirect}
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 bg-page text-slate-500 rounded text-[10px] font-bold">
                            {t.methodUnknown}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1.5 text-slate-500 text-sm">
                        <Calendar className="w-3.5 h-3.5" />
                        {formatRequestDate(req.createdAt)}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          {req.status === 'pending' && (
                            <span className="flex items-center gap-1.5 text-amber-600 text-sm font-medium">
                              <Clock className="w-4 h-4" />
                              {t.statusPending}
                            </span>
                          )}
                          {req.status === 'approved' && (
                            <span className="flex items-center gap-1.5 text-emerald-600 text-sm font-medium">
                              <CheckCircle2 className="w-4 h-4" />
                              {t.statusApproved}
                            </span>
                          )}
                          {req.status === 'rejected' && (
                            <span className="flex items-center gap-1.5 text-red-600 text-sm font-medium">
                              <XCircle className="w-4 h-4" />
                              {t.statusRejected}
                            </span>
                          )}
                        </div>
                        {req.reason && (
                          <p
                            className="text-[10px] text-slate-400 italic max-w-[150px] truncate"
                            title={req.reason}
                          >
                            {req.reason}
                          </p>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      {req.status === 'pending' && (
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => setShowRejectModal(req.id)}
                            disabled={!!processingId}
                            className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                            title={t.rejectBtn}
                          >
                            {processingId === req.id ? (
                              <RefreshCw className="w-5 h-5 animate-spin" />
                            ) : (
                              <XIcon className="w-5 h-5" />
                            )}
                          </button>
                          <button
                            onClick={() => handleApprove(req)}
                            disabled={!!processingId}
                            className="p-2 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors disabled:opacity-50"
                            title={t.approveBtn}
                          >
                            {processingId === req.id ? (
                              <RefreshCw className="w-5 h-5 animate-spin" />
                            ) : (
                              <Check className="w-5 h-5" />
                            )}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Reject Modal */}
      <AnimatePresence>
        {showRejectModal && (
          <ModalPortal>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm"
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                className="bg-surface rounded-2xl shadow-2xl max-w-md w-full overflow-hidden"
              >
                <div className="p-6 border-b border-border-light flex items-center justify-between">
                  <h3 className="text-lg font-bold text-heading">{t.rejectTitle}</h3>
                  <button
                    onClick={() => setShowRejectModal(null)}
                    className="p-2 hover:bg-slate-100 rounded-lg"
                  >
                    <XIcon className="w-5 h-5 text-slate-400" />
                  </button>
                </div>
                <div className="p-6 space-y-4">
                  <div className="p-3 bg-amber-50 dark:bg-amber-500/10 border border-amber-100 rounded-xl flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <p className="text-xs text-amber-700 dark:text-amber-400">{t.rejectHint}</p>
                  </div>
                  <textarea
                    value={rejectionReason}
                    onChange={(e) => setRejectionReason(e.target.value)}
                    placeholder={t.rejectPlaceholder}
                    className="w-full px-4 py-3 bg-page border border-border-default rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all text-sm min-h-[100px]"
                  />
                  <div className="flex gap-3">
                    <button
                      onClick={() => setShowRejectModal(null)}
                      className="flex-1 px-4 py-2.5 border border-border-default text-slate-600 rounded-xl font-medium hover:bg-hover"
                    >
                      {tCommon.cancel}
                    </button>
                    <button
                      onClick={() => handleReject(showRejectModal)}
                      disabled={!rejectionReason.trim() || !!processingId}
                      className="inline-flex flex-1 items-center justify-center gap-2 px-4 py-2.5 bg-red-600 text-white rounded-xl font-medium hover:bg-red-700 disabled:opacity-50"
                    >
                      {processingId === showRejectModal && (
                        <RefreshCw className="h-4 w-4 animate-spin" />
                      )}
                      {processingId === showRejectModal ? t.processing : t.rejectConfirm}
                    </button>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          </ModalPortal>
        )}
      </AnimatePresence>

      {/* Success Modal with Temp Password */}
      <AnimatePresence>
        {showSuccessModal && (
          <ModalPortal>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm"
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                className="bg-surface rounded-2xl shadow-2xl max-w-md w-full overflow-hidden"
              >
                <div className="p-6 bg-emerald-600 text-white flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
                      <CheckCircle2 className="w-6 h-6" />
                    </div>
                    <h3 className="text-lg font-bold">{t.successTitle}</h3>
                  </div>
                  <button
                    onClick={() => setShowSuccessModal(null)}
                    className="p-2 hover:bg-white/10 rounded-lg"
                  >
                    <XIcon className="w-5 h-5" />
                  </button>
                </div>
                <div className="p-8 space-y-6">
                  <div className="text-center space-y-2">
                    <p className="text-sm text-slate-500">
                      {t.tempPasswordLabel.replace('{name}', showSuccessModal.studentName)}:
                    </p>
                    <div className="bg-page border-2 border-dashed border-border-default rounded-2xl p-6 relative group">
                      <span className="text-3xl font-mono font-bold text-blue-600 tracking-widest">
                        {showSuccessModal.tempPassword}
                      </span>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(showSuccessModal.tempPassword);
                          toast.success(t.passwordCopied);
                        }}
                        className="absolute top-2 right-2 p-2 text-slate-400 hover:text-blue-600 hover:bg-surface rounded-lg transition-all shadow-sm opacity-0 group-hover:opacity-100"
                      >
                        <Copy className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="p-4 bg-blue-50 dark:bg-blue-500/10 rounded-xl border border-blue-100 flex items-start gap-3">
                      <Phone className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                      <div>
                        <p className="text-xs font-bold text-blue-900 dark:text-blue-200">
                          {t.sendToUser}
                        </p>
                        <p className="text-sm text-blue-700 dark:text-blue-400 font-medium">
                          {showSuccessModal.phoneNumber}
                        </p>
                      </div>
                    </div>

                    <p className="text-xs text-slate-400 leading-relaxed text-center italic">
                      {t.systemNote}
                    </p>
                  </div>

                  <div className="flex gap-3">
                    <button
                      onClick={() => {
                        window.open(
                          `https://zalo.me/${showSuccessModal.phoneNumber.replace(/^0/, '84')}`,
                          '_blank'
                        );
                      }}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-all"
                    >
                      <ExternalLink className="w-4 h-4" />
                      {t.openZalo}
                    </button>
                    <button
                      onClick={() => setShowSuccessModal(null)}
                      className="flex-1 px-4 py-3 bg-slate-100 text-slate-700 rounded-xl font-bold hover:bg-slate-200 transition-all"
                    >
                      {t.close}
                    </button>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          </ModalPortal>
        )}
      </AnimatePresence>
    </div>
  );
}
