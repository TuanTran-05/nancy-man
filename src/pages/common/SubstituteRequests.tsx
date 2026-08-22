import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '../../lib/api/apiClient';
import { SubstituteRequest } from '../../types';
import { useAuth } from '../../contexts/AuthContext';
import {
  CalendarDays,
  CheckCircle2,
  XCircle,
  Clock,
  Search,
  Filter,
  User,
  BookOpen,
  ArrowLeftRight,
  Plus,
  Trash2,
  Loader2,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { format, parseISO } from 'date-fns';
import { vi } from 'date-fns/locale';
import { cn, getVNTodayStr } from '../../lib/core/utils';
import { useLanguage } from '../../lib/i18n/useLanguage';
import { CreateSubstituteRequestModal } from '../../components/notifications/CreateSubstituteRequestModal';
import { FRONTEND_COLLECTION_LIMIT } from '../../lib/api/readLimits';
import { filterClassesForRoleOutsideAdminDashboard } from '../../../shared/classVisibility';
import {
  FRONTEND_READ_POLL_INTERVAL_MS,
  readClassesData,
} from '../../lib/api/frontendReadApi';
import { readChannel } from '../../lib/api/readApi';

export default function SubstituteRequests() {
  const { profile } = useAuth();
  const { language, t } = useLanguage();
  const T = t.substitute;
  const isAdmin = profile?.role === 'admin';

  const [activeTab, setActiveTab] = useState<'my' | 'available'>('available');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<
    'all' | 'pending' | 'accepted' | 'cancelled' | 'completed'
  >('all');
  const [processingId, setProcessingId] = useState<string | null>(null);

  const classesQuery = useQuery({
    queryKey: ['read', 'classes', profile?.uid, profile?.role],
    queryFn: readClassesData,
    enabled: Boolean(profile?.uid),
    refetchInterval: FRONTEND_READ_POLL_INTERVAL_MS,
  });
  const requestsQuery = useQuery({
    queryKey: ['read', 'substitute-requests', profile?.uid, profile?.role],
    queryFn: () =>
      readChannel<{ requests: SubstituteRequest[] }>('substitute-requests', {
        limit: FRONTEND_COLLECTION_LIMIT,
      }),
    enabled: Boolean(profile?.uid),
    refetchInterval: FRONTEND_READ_POLL_INTERVAL_MS,
  });

  const classes = filterClassesForRoleOutsideAdminDashboard(
    classesQuery.data?.classes || [],
    profile?.role
  );
  const requestRows = requestsQuery.data?.requests || [];
  const myRequests = requestRows.filter((row) => row.requestingTeacherId === profile?.uid);
  const availableRequests = requestRows.filter(
    (row) => row.status === 'pending' && row.requestingTeacherId !== profile?.uid
  );
  const allRequests = isAdmin ? requestRows : [];
  const loading = requestsQuery.isPending;

  const handleCreateRequest = async (
    classId: string,
    className: string,
    date: string,
    reason: string
  ) => {
    if (!profile?.uid || !profile?.displayName) return;

    try {
      await apiRequest('/api/v1/classes/create-substitute-request', {
        method: 'POST',
        body: { classId, date, reason },
      });
      toast.success(T.createSuccess);
    } catch (err) {
      console.error('Error creating substitute request:', err);
      toast.error(t.substitutePage.createError);
    }
  };

  const handleAccept = async (request: SubstituteRequest) => {
    if (!profile?.uid || processingId) return;
    if (request.requestingTeacherId === profile.uid) {
      toast.error(T.cannotAcceptOwn);
      return;
    }

    setProcessingId(request.id);
    try {
      await apiRequest('/api/v1/classes/accept-substitute-request', {
        method: 'POST',
        body: { requestId: request.id },
      });
      toast.success(T.acceptSuccess);
    } catch (err: any) {
      toast.error(err.message || 'Error');
    } finally {
      setProcessingId(null);
    }
  };

  const handleCancel = async (request: SubstituteRequest) => {
    if (processingId) return;
    const isAccepted = request.status === 'accepted';
    const confirmMsg = isAccepted ? T.cancelAcceptedConfirm : T.cancelConfirm;
    if (!window.confirm(confirmMsg)) return;

    setProcessingId(request.id);
    try {
      await apiRequest('/api/v1/classes/cancel-substitute-request', {
        method: 'POST',
        body: { requestId: request.id },
      });
      toast.success(T.cancelSuccess);
    } catch (err: any) {
      toast.error(err.message || 'Error');
    } finally {
      setProcessingId(null);
    }
  };

  const handleAdminCancel = async (request: SubstituteRequest) => {
    if (processingId) return;
    if (!window.confirm(T.adminCancelConfirm)) return;

    setProcessingId(request.id);
    try {
      await apiRequest('/api/v1/classes/cancel-substitute-request', {
        method: 'POST',
        body: { requestId: request.id },
      });
      toast.success(T.adminCancelSuccess);
    } catch (err: any) {
      toast.error(err.message || 'Error');
    } finally {
      setProcessingId(null);
    }
  };

  const getStatusBadge = (status: SubstituteRequest['status']) => {
    const styles: Record<string, string> = {
      pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
      accepted: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
      cancelled:
        'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 font-bold border border-red-200 dark:border-red-800',
      completed: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    };
    return styles[status] || styles.pending;
  };

  const formatDate = (dateStr: string) => {
    try {
      return format(parseISO(dateStr), 'dd/MM/yyyy (EEEE)', {
        locale: language === 'vi' ? vi : undefined,
      });
    } catch {
      return dateStr;
    }
  };

  const filteredMyRequests = myRequests.filter((r) => {
    const matchesSearch =
      r.className.toLowerCase().includes(searchTerm.toLowerCase()) ||
      r.requestingTeacherName.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'all' || r.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const pendingCount = availableRequests.length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <ArrowLeftRight className="w-7 h-7 text-blue-500" />
            {T.title}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{T.desc}</p>
        </div>
        {!isAdmin && (
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors shadow-sm"
          >
            <Plus className="w-4 h-4" />
            {T.createRequest}
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 p-1 rounded-lg w-fit">
        {isAdmin ? (
          <>
            <button
              onClick={() => setActiveTab('available')}
              className={cn(
                'px-4 py-2 text-sm font-medium rounded-md transition-all relative',
                activeTab === 'available'
                  ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
              )}
            >
              {T.allRequests}
              {allRequests.length > 0 && (
                <span className="ml-1.5 px-1.5 py-0.5 text-xs bg-blue-500 text-white rounded-full">
                  {allRequests.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('my')}
              className={cn(
                'px-4 py-2 text-sm font-medium rounded-md transition-all relative',
                activeTab === 'my'
                  ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
              )}
            >
              {T.availableRequests}
              {pendingCount > 0 && (
                <span className="ml-1.5 px-1.5 py-0.5 text-xs bg-red-500 text-white rounded-full">
                  {pendingCount}
                </span>
              )}
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => setActiveTab('available')}
              className={cn(
                'px-4 py-2 text-sm font-medium rounded-md transition-all relative',
                activeTab === 'available'
                  ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
              )}
            >
              {T.availableRequests}
              {pendingCount > 0 && (
                <span className="ml-1.5 px-1.5 py-0.5 text-xs bg-red-500 text-white rounded-full">
                  {pendingCount}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('my')}
              className={cn(
                'px-4 py-2 text-sm font-medium rounded-md transition-all',
                activeTab === 'my'
                  ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
              )}
            >
              {T.myRequests}
            </button>
          </>
        )}
      </div>

      {/* Filters */}
      {(activeTab === 'my' || (isAdmin && activeTab === 'available')) && (
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder={t.common.search}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="px-3 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
          >
            <option value="all">{T.allStatuses}</option>
            <option value="pending">{T.status.pending}</option>
            <option value="accepted">{T.status.accepted}</option>
            <option value="cancelled">{T.status.cancelled}</option>
            <option value="completed">{T.status.completed}</option>
          </select>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
        </div>
      ) : isAdmin ? (
        /* ===== ADMIN VIEW ===== */
        activeTab === 'available' ? (
          /* Admin: All requests tab */
          (() => {
            const filtered = allRequests.filter((r) => {
              const matchesSearch =
                r.className.toLowerCase().includes(searchTerm.toLowerCase()) ||
                r.requestingTeacherName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                (r.substituteTeacherName || '').toLowerCase().includes(searchTerm.toLowerCase());
              const matchesStatus = statusFilter === 'all' || r.status === statusFilter;
              return matchesSearch && matchesStatus;
            });
            return filtered.length === 0 ? (
              <div className="text-center py-16">
                <ArrowLeftRight className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
                <p className="text-gray-500 dark:text-gray-400">{T.noMyRequests}</p>
              </div>
            ) : (
              <div className="grid gap-4">
                {filtered.map((request) => (
                  <motion.div
                    key={request.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={cn(
                      'rounded-xl border border-gray-200 dark:border-gray-700 p-5',
                      request.status === 'cancelled'
                        ? 'bg-gray-50 dark:bg-gray-800/50 opacity-75'
                        : 'bg-white dark:bg-gray-800'
                    )}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                      <div className="space-y-2">
                        <span
                          className={cn(
                            'px-2.5 py-1 text-xs font-medium rounded-full',
                            getStatusBadge(request.status)
                          )}
                        >
                          {T.status[request.status]}
                        </span>
                        <div className="flex items-center gap-2">
                          <User className="w-4 h-4 text-gray-400" />
                          <span className="text-sm text-gray-500">{T.requestingLabel}</span>
                          <span className="font-medium text-gray-900 dark:text-white">
                            {request.requestingTeacherName}
                          </span>
                        </div>
                        {request.substituteTeacherName && (
                          <div className="flex items-center gap-2">
                            <User className="w-4 h-4 text-green-500" />
                            <span className="text-sm text-gray-500">{T.substituteLabel}</span>
                            <span className="font-medium text-green-600 dark:text-green-400">
                              {request.substituteTeacherName}
                            </span>
                          </div>
                        )}
                        <div className="flex items-center gap-2">
                          <BookOpen className="w-4 h-4 text-gray-400" />
                          <span className="text-sm text-gray-500">{T.className}:</span>
                          <span className="font-medium text-gray-900 dark:text-white">
                            {request.className}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <CalendarDays className="w-4 h-4 text-gray-400" />
                          <span className="text-sm text-gray-500">{T.date}:</span>
                          <span className="font-medium text-gray-900 dark:text-white">
                            {formatDate(request.date)}
                          </span>
                        </div>
                        {request.reason && (
                          <p className="text-sm text-gray-500">
                            {T.reason}: {request.reason}
                          </p>
                        )}
                      </div>
                      {request.status !== 'cancelled' && (
                        <button
                          onClick={() => handleAdminCancel(request)}
                          disabled={processingId === request.id}
                          className="flex items-center gap-2 px-4 py-2 bg-red-50 hover:bg-red-100 dark:bg-red-900/20 dark:hover:bg-red-900/30 text-red-600 dark:text-red-400 text-sm font-medium rounded-lg transition-colors whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {processingId === request.id ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <XCircle className="w-4 h-4" />
                          )}
                          {processingId === request.id ? T.submitting : T.adminCancel}
                        </button>
                      )}
                    </div>
                  </motion.div>
                ))}
              </div>
            );
          })()
        ) : /* Admin: Pending requests tab */
        availableRequests.length === 0 ? (
          <div className="text-center py-16">
            <ArrowLeftRight className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
            <p className="text-gray-500 dark:text-gray-400">{T.noAvailableRequests}</p>
          </div>
        ) : (
          <div className="grid gap-4">
            {availableRequests.map((request) => (
              <motion.div
                key={request.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={cn(
                  'rounded-xl border border-gray-200 dark:border-gray-700 p-5 hover:shadow-md transition-shadow',
                  request.status === 'cancelled'
                    ? 'bg-gray-50 dark:bg-gray-800/50 opacity-75'
                    : 'bg-white dark:bg-gray-800'
                )}
              >
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <User className="w-4 h-4 text-gray-400" />
                      <span className="text-sm text-gray-500">{T.requestingTeacher}:</span>
                      <span className="font-medium text-gray-900 dark:text-white">
                        {request.requestingTeacherName}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <BookOpen className="w-4 h-4 text-gray-400" />
                      <span className="text-sm text-gray-500">{T.className}:</span>
                      <span className="font-medium text-gray-900 dark:text-white">
                        {request.className}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <CalendarDays className="w-4 h-4 text-gray-400" />
                      <span className="text-sm text-gray-500">{T.date}:</span>
                      <span className="font-medium text-gray-900 dark:text-white">
                        {formatDate(request.date)}
                      </span>
                    </div>
                    {request.reason && (
                      <p className="text-sm text-gray-500">
                        {T.reason}: {request.reason}
                      </p>
                    )}
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )
      ) : /* ===== TEACHER VIEW ===== */
      activeTab === 'available' ? (
        availableRequests.length === 0 ? (
          <div className="text-center py-16">
            <ArrowLeftRight className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
            <p className="text-gray-500 dark:text-gray-400">{T.noAvailableRequests}</p>
          </div>
        ) : (
          <div className="grid gap-4">
            {availableRequests.map((request) => (
              <motion.div
                key={request.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={cn(
                  'rounded-xl border border-gray-200 dark:border-gray-700 p-5 hover:shadow-md transition-shadow',
                  request.status === 'cancelled'
                    ? 'bg-gray-50 dark:bg-gray-800/50 opacity-75'
                    : 'bg-white dark:bg-gray-800'
                )}
              >
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <User className="w-4 h-4 text-gray-400" />
                      <span className="text-sm text-gray-500">{T.requestingTeacher}:</span>
                      <span className="font-medium text-gray-900 dark:text-white">
                        {request.requestingTeacherName}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <BookOpen className="w-4 h-4 text-gray-400" />
                      <span className="text-sm text-gray-500">{T.className}:</span>
                      <span className="font-medium text-gray-900 dark:text-white">
                        {request.className}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <CalendarDays className="w-4 h-4 text-gray-400" />
                      <span className="text-sm text-gray-500">{T.date}:</span>
                      <span className="font-medium text-gray-900 dark:text-white">
                        {formatDate(request.date)}
                      </span>
                    </div>
                    {request.reason && (
                      <p className="text-sm text-gray-500">
                        {T.reason}: {request.reason}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => handleAccept(request)}
                    disabled={processingId === request.id}
                    className="flex items-center gap-2 px-5 py-2.5 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors shadow-sm whitespace-nowrap"
                  >
                    {processingId === request.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="w-4 h-4" />
                    )}
                    {processingId === request.id ? T.submitting : T.accept}
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        )
      ) : filteredMyRequests.length === 0 ? (
        <div className="text-center py-16">
          <CalendarDays className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
          <p className="text-gray-500 dark:text-gray-400">{T.noMyRequests}</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {filteredMyRequests.map((request) => (
            <motion.div
              key={request.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={cn(
                'rounded-xl border border-gray-200 dark:border-gray-700 p-5',
                request.status === 'cancelled'
                  ? 'bg-gray-50 dark:bg-gray-800/50 opacity-75'
                  : 'bg-white dark:bg-gray-800'
              )}
            >
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                <div className="space-y-2">
                  <span
                    className={cn(
                      'px-2.5 py-1 text-xs font-medium rounded-full',
                      getStatusBadge(request.status)
                    )}
                  >
                    {T.status[request.status]}
                  </span>
                  <div className="flex items-center gap-2">
                    <BookOpen className="w-4 h-4 text-gray-400" />
                    <span className="text-sm text-gray-500">{T.className}:</span>
                    <span className="font-medium text-gray-900 dark:text-white">
                      {request.className}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CalendarDays className="w-4 h-4 text-gray-400" />
                    <span className="text-sm text-gray-500">{T.date}:</span>
                    <span className="font-medium text-gray-900 dark:text-white">
                      {formatDate(request.date)}
                    </span>
                  </div>
                  {request.substituteTeacherName && (
                    <div className="flex items-center gap-2">
                      <User className="w-4 h-4 text-gray-400" />
                      <span className="text-sm text-gray-500">{T.substituteTeacher}:</span>
                      <span className="font-medium text-green-600 dark:text-green-400">
                        {request.substituteTeacherName}
                      </span>
                    </div>
                  )}
                  {request.reason && (
                    <p className="text-sm text-gray-500">
                      {T.reason}: {request.reason}
                    </p>
                  )}
                </div>
                {(request.status === 'pending' || request.status === 'accepted') && (
                  <button
                    onClick={() => handleCancel(request)}
                    disabled={processingId === request.id}
                    className="flex items-center gap-2 px-4 py-2 bg-red-50 hover:bg-red-100 dark:bg-red-900/20 dark:hover:bg-red-900/30 text-red-600 dark:text-red-400 text-sm font-medium rounded-lg transition-colors whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {processingId === request.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <XCircle className="w-4 h-4" />
                    )}
                    {processingId === request.id ? T.submitting : T.cancel}
                  </button>
                )}
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Create Modal */}
      <CreateSubstituteRequestModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        classes={classes}
        teachers={
          profile?.uid ? [{ uid: profile.uid, displayName: profile.displayName || 'GV' }] : []
        }
        existingRequests={myRequests}
        onSubmit={handleCreateRequest}
      />
    </div>
  );
}
