import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { apiRequest } from '../../lib/api/apiClient';
import { StaffPasswordResetRequest } from '../../types';
import { useAuth } from '../../contexts/AuthContext';
import {
  ShieldAlert,
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
  Copy,
  KeyRound,
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

export default function StaffPasswordResetRequests() {
  const { profile } = useAuth();
  const { language } = useLanguage();
  const t = translations[language].staffPasswordResetPage;
  const [requests, setRequests] = useState<StaffPasswordResetRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>(
    'pending'
  );
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [showRejectModal, setShowRejectModal] = useState<string | null>(null);
  const [showSuccessModal, setShowSuccessModal] = useState<{
    displayName: string;
    email: string;
    tempPassword: string;
  } | null>(null);

  useBodyScrollLock(!!showRejectModal || !!showSuccessModal);

  useEffect(() => {
    let cancelled = false;
    const loadRequests = async () => {
      try {
        const data = await readChannel<{ requests: StaffPasswordResetRequest[] }>(
          'staff-password-reset-requests',
          { limit: FRONTEND_COLLECTION_LIMIT }
        );
        if (cancelled) return;
        setRequests(data.requests || []);
        setLoading(false);
      } catch (error) {
        if (cancelled) return;
        console.error('Error fetching staff reset requests through read API:', error);
        setLoading(false);
      }
    };

    void loadRequests();
    const interval = setInterval(() => void loadRequests(), FRONTEND_READ_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const handleApprove = async (request: StaffPasswordResetRequest) => {
    if (processingId) return;
    if (!request.uid) {
      toast.error(t.uidNotFound);
      return;
    }

    setProcessingId(request.id);
    try {
      const data = await apiRequest<{
        success: boolean;
        retrievalToken?: string;
        tempPassword?: string;
      }>('/api/v1/auth/staff-approve-reset-request', {
        method: 'POST',
        body: { requestId: request.id, uid: request.uid },
      });

      let tempPassword = data.tempPassword || '';
      if (!tempPassword) {
        if (!data.retrievalToken) {
          throw new Error('Missing temporary password retrieval token');
        }

        const retrieveResult = await apiRequest<{ success: boolean; tempPassword?: string }>(
          '/api/v1/auth/retrieve-temp-password',
          {
            method: 'POST',
            body: { token: data.retrievalToken },
          }
        );
        tempPassword = retrieveResult.tempPassword || '';
      }

      if (!tempPassword) {
        throw new Error('Failed to retrieve temporary password');
      }

      setShowSuccessModal({
        displayName: request.displayName,
        email: request.email,
        tempPassword,
      });

      toast.success(t.resetSuccess);
    } catch (err: any) {
      console.error('Error approving staff reset:', err);
      toast.error(t.resetError + (err.message || 'Unknown error'));
    } finally {
      setProcessingId(null);
    }
  };

  const handleReject = async (requestId: string) => {
    if (!rejectionReason.trim() || processingId) return;

    setProcessingId(requestId);
    try {
      await apiRequest('/api/v1/auth/staff-reject-reset-request', {
        method: 'POST',
        body: { requestId, reason: rejectionReason.trim() },
      });
      setShowRejectModal(null);
      setRejectionReason('');
      toast.success(t.rejectSuccess);
    } catch (err) {
      console.error('Error rejecting request:', err);
      toast.error(t.rejectError);
    } finally {
      setProcessingId(null);
    }
  };

  const filteredRequests = requests.filter((r) => {
    const matchSearch =
      r.displayName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      r.email?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchStatus = statusFilter === 'all' || r.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const pendingCount = requests.filter((r) => r.status === 'pending').length;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 bg-purple-100 dark:bg-purple-500/20 rounded-xl flex items-center justify-center">
            <KeyRound className="w-5 h-5 text-purple-600 dark:text-purple-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t.title}</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">{t.subtitle}</p>
          </div>
        </div>
        {pendingCount > 0 && (
          <div className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-800 rounded-full text-sm font-medium text-amber-700 dark:text-amber-400">
            <Clock className="w-4 h-4" />
            {t.pendingCount.replace('{count}', String(pendingCount))}
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm mb-6">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="w-5 h-5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder={t.searchPlaceholder}
              className="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-slate-700 border border-slate-100 dark:border-slate-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-700 dark:text-slate-200"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <Filter className="w-5 h-5 text-slate-400" />
            <select
              className="bg-slate-50 dark:bg-slate-700 border border-slate-100 dark:border-slate-600 text-slate-700 dark:text-slate-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
            >
              <option value="pending">{t.pending}</option>
              <option value="approved">{t.approved}</option>
              <option value="rejected">{t.rejected}</option>
              <option value="all">{t.all}</option>
            </select>
          </div>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex justify-center py-12">
          <RefreshCw className="w-8 h-8 text-blue-600 animate-spin" />
        </div>
      ) : filteredRequests.length === 0 ? (
        <div className="text-center py-12 bg-white dark:bg-slate-800 rounded-2xl border border-dashed border-slate-300 dark:border-slate-600">
          <ShieldAlert className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
          <h3 className="text-lg font-bold text-slate-700 dark:text-slate-300">{t.noRequests}</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            {statusFilter === 'pending' ? t.noPendingRequests : t.noMatchingRequests}
          </p>
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-700/50 border-b border-slate-100 dark:border-slate-700">
                  <th className="text-left py-3 px-4 font-semibold text-slate-600 dark:text-slate-300">
                    {t.staff}
                  </th>
                  <th className="text-left py-3 px-4 font-semibold text-slate-600 dark:text-slate-300">
                    Email
                  </th>
                  <th className="text-left py-3 px-4 font-semibold text-slate-600 dark:text-slate-300">
                    {t.role}
                  </th>
                  <th className="text-left py-3 px-4 font-semibold text-slate-600 dark:text-slate-300">
                    {t.sentDate}
                  </th>
                  <th className="text-left py-3 px-4 font-semibold text-slate-600 dark:text-slate-300">
                    {t.status}
                  </th>
                  <th className="text-right py-3 px-4 font-semibold text-slate-600 dark:text-slate-300">
                    {t.actions}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {filteredRequests.map((request) => (
                  <tr
                    key={request.id}
                    className="hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors"
                  >
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-blue-100 dark:bg-blue-500/20 rounded-full flex items-center justify-center">
                          <User className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                        </div>
                        <span className="font-medium text-slate-900 dark:text-white">
                          {request.displayName}
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-slate-600 dark:text-slate-400">
                      {request.email}
                    </td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-1 text-xs font-medium rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                        {request.role}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-slate-500 dark:text-slate-400">
                      {request.createdAt
                        ? format(new Date(request.createdAt), 'dd/MM/yyyy HH:mm', { locale: vi })
                        : '—'}
                    </td>
                    <td className="py-3 px-4">
                      {request.status === 'pending' && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400">
                          <Clock className="w-3 h-3" /> {t.pending}
                        </span>
                      )}
                      {request.status === 'approved' && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400">
                          <CheckCircle2 className="w-3 h-3" /> {t.approved}
                        </span>
                      )}
                      {request.status === 'rejected' && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-400">
                          <XCircle className="w-3 h-3" /> {t.rejected}
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right">
                      {request.status === 'pending' && (
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleApprove(request)}
                            disabled={processingId === request.id}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50"
                          >
                            {processingId === request.id ? (
                              <RefreshCw className="w-3 h-3 animate-spin" />
                            ) : (
                              <Check className="w-3 h-3" />
                            )}
                            {t.approve}
                          </button>
                          <button
                            onClick={() => setShowRejectModal(request.id)}
                            disabled={processingId === request.id}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-400 rounded-lg hover:bg-red-200 dark:hover:bg-red-500/30 transition-colors disabled:opacity-50"
                          >
                            <XIcon className="w-3 h-3" />
                            {t.reject}
                          </button>
                        </div>
                      )}
                      {request.status === 'rejected' && request.reason && (
                        <span className="text-xs text-slate-500 dark:text-slate-400 italic">
                          {t.reasonLabel} {request.reason}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Reject Modal */}
      <AnimatePresence>
        {showRejectModal && (
          <ModalPortal>
            <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl w-full max-w-sm overflow-hidden"
              >
                <div className="p-6">
                  <div className="w-12 h-12 bg-red-100 dark:bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                    <XCircle className="w-6 h-6 text-red-600 dark:text-red-400" />
                  </div>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white text-center mb-2">
                    {t.rejectTitle}
                  </h3>
                  <p className="text-sm text-slate-500 dark:text-slate-400 text-center mb-4">
                    {t.rejectPrompt}
                  </p>
                  <textarea
                    value={rejectionReason}
                    onChange={(e) => setRejectionReason(e.target.value)}
                    placeholder={t.reasonPlaceholder}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-700 border border-slate-100 dark:border-slate-600 rounded-xl focus:ring-2 focus:ring-red-500 focus:border-red-500 text-slate-700 dark:text-slate-200 outline-none resize-none"
                    rows={3}
                  />
                  <div className="flex gap-3 mt-4">
                    <button
                      onClick={() => {
                        setShowRejectModal(null);
                        setRejectionReason('');
                      }}
                      className="flex-1 px-4 py-2.5 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 font-medium rounded-xl hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
                    >
                      {t.cancel}
                    </button>
                    <button
                      onClick={() => handleReject(showRejectModal)}
                      disabled={!rejectionReason.trim() || processingId === showRejectModal}
                      className="flex-1 px-4 py-2.5 bg-red-600 text-white font-medium rounded-xl hover:bg-red-700 transition-colors disabled:opacity-50"
                    >
                      {processingId === showRejectModal ? t.processing : t.reject}
                    </button>
                  </div>
                </div>
              </motion.div>
            </div>
          </ModalPortal>
        )}
      </AnimatePresence>

      {/* Success Modal */}
      <AnimatePresence>
        {showSuccessModal && (
          <ModalPortal>
            <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl w-full max-w-sm overflow-hidden"
              >
                <div className="p-6 text-center">
                  <div className="w-16 h-16 bg-emerald-100 dark:bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                    <CheckCircle2 className="w-8 h-8 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
                    {t.resetSuccessTitle}
                  </h3>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
                    {t.tempPasswordFor} <strong>{showSuccessModal.displayName}</strong> (
                    {showSuccessModal.email}):
                  </p>
                  <div className="bg-slate-100 dark:bg-slate-700 rounded-xl p-4 mb-4 flex items-center justify-between">
                    <code className="text-lg font-mono font-bold text-blue-600 dark:text-blue-400 select-all">
                      {showSuccessModal.tempPassword}
                    </code>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(showSuccessModal.tempPassword);
                        toast.success(t.copied);
                      }}
                      className="p-2 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                      title={t.copyTitle}
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-800 rounded-xl p-3 mb-4">
                    <p className="text-xs text-amber-700 dark:text-amber-400 flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>{t.passwordNote}</span>
                    </p>
                  </div>
                  <button
                    onClick={() => setShowSuccessModal(null)}
                    className="w-full bg-blue-600 text-white font-bold py-3 rounded-xl hover:bg-blue-700 transition-colors"
                  >
                    {t.understood}
                  </button>
                </div>
              </motion.div>
            </div>
          </ModalPortal>
        )}
      </AnimatePresence>
    </div>
  );
}
