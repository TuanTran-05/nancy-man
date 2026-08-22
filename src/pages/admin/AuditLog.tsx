import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Shield,
  Filter,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Search,
  Activity,
  LogIn,
  Users,
  Pencil,
  Download,
  Clock,
  Globe,
  Monitor,
  Calendar,
  AlertCircle,
  X,
} from 'lucide-react';
import { useLanguage } from '../../lib/i18n/useLanguage';
import { parseUserAgent } from '../../lib/parsing/parseUserAgent';
import type { AuditLogEntry } from '../../types';
import { localize } from '../../lib/i18n/localize';
import { readChannel } from '../../lib/api/readApi';
import { ApiDateTextInput } from '../../components/forms/ApiDateTimeInputs';

const ACTION_COLORS: Record<string, string> = {
  create: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400',
  update: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400',
  delete: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400',
  login: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400',
  logout: 'bg-gray-100 text-gray-700 dark:bg-gray-500/15 dark:text-gray-400',
  password_reset: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400',
  status_change: 'bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-400',
  export: 'bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-400',
  import: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-400',
};

interface AuditStats {
  totalToday: number;
  loginsToday: number;
  changesToday: number;
  uniqueUsersToday: number;
}

interface AuditUserLookup {
  displayName?: string;
  email?: string;
  role?: string;
}

function relativeTime(ts: string, t: any): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return t.auditLogPage.justNow;
  if (mins < 60) return t.auditLogPage.minutesAgo.replace('{count}', String(mins));
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return t.auditLogPage.hoursAgo.replace('{count}', String(hrs));
  const days = Math.floor(hrs / 24);
  return t.auditLogPage.daysAgo.replace('{count}', String(days));
}

function groupByDate(
  logs: AuditLogEntry[],
  t: any,
  lang: string
): { label: string; logs: AuditLogEntry[] }[] {
  const groups: Record<string, AuditLogEntry[]> = {};
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  for (const log of logs) {
    const d = new Date(log.timestamp);
    d.setHours(0, 0, 0, 0);
    let key: string;
    if (d.getTime() === today.getTime()) key = t.auditLogPage.today;
    else if (d.getTime() === yesterday.getTime()) key = t.auditLogPage.yesterday;
    else
      key = d.toLocaleDateString(localize(lang, 'vi-VN', 'en-GB'), {
        weekday: 'long',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      });
    if (!groups[key]) groups[key] = [];
    groups[key].push(log);
  }
  return Object.entries(groups).map(([label, logs]) => ({ label, logs }));
}

function getUserNameFromLookup(user?: AuditUserLookup): string {
  return (user?.displayName || user?.email || '').trim();
}

function getUserParts(
  id: string | undefined,
  userMap: Record<string, AuditUserLookup>,
  fallbackName?: string,
  fallbackRole?: string
) {
  const user = id ? userMap[id] : undefined;
  const lookupName = getUserNameFromLookup(user);
  const rawFallbackName = (fallbackName || '').trim();
  const name =
    rawFallbackName && rawFallbackName !== id ? rawFallbackName : lookupName || rawFallbackName;
  return {
    id: id || '',
    name,
    role: fallbackRole || user?.role || '',
  };
}

function formatUserLabel(
  id: string | undefined,
  userMap: Record<string, AuditUserLookup>,
  fallbackName?: string
): string {
  const user = getUserParts(id, userMap, fallbackName);
  if (user.name && user.id && user.name !== user.id) return `${user.name} (ID: ${user.id})`;
  return user.name || user.id || '-';
}

function getTargetParts(log: AuditLogEntry, t: any, userMap: Record<string, AuditUserLookup>) {
  const collectionName = t.auditLogPage.collections[log.collection] || log.collection;
  const target =
    log.collection === 'users' ? formatUserLabel(log.documentId, userMap) : log.documentId || '-';
  return { collectionName, target };
}

function formatTargetLabel(
  log: AuditLogEntry,
  t: any,
  userMap: Record<string, AuditUserLookup>
): string {
  const target = getTargetParts(log, t, userMap);
  return `${target.collectionName}/${target.target}`;
}

function resolveAuditValue(value: unknown, userMap: Record<string, AuditUserLookup>): string {
  if (typeof value !== 'string') return String(value ?? '');
  return userMap[value] ? formatUserLabel(value, userMap) : value;
}

function exportCSV(
  logs: AuditLogEntry[],
  t: any,
  lang: string,
  userMap: Record<string, AuditUserLookup>
) {
  const headers = [
    t.auditLogPage.csvHeaders.time,
    t.auditLogPage.csvHeaders.user,
    t.auditLogPage.csvHeaders.role,
    t.auditLogPage.csvHeaders.action,
    t.auditLogPage.csvHeaders.collection,
    t.auditLogPage.csvHeaders.target,
    t.auditLogPage.ip,
    t.auditLogPage.csvHeaders.device,
    t.auditLogPage.csvHeaders.details,
  ];
  const rows = logs.map((l) => [
    l.timestamp,
    formatUserLabel(l.userId, userMap, l.userName),
    l.userRole,
    t.auditLogPage.actions[l.action] || l.action,
    l.collection,
    formatTargetLabel(l, t, userMap),
    l.ip || '',
    l.userAgent ? parseUserAgent(l.userAgent).label : '',
    l.metadata ? JSON.stringify(l.metadata) : '',
  ]);
  const csv = [headers, ...rows]
    .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `audit_log_${new Date().toISOString().split('T')[0]}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function getCleanupCountdown(
  t: any
): { show: boolean; message: string; isCleanupDay: boolean } | null {
  const day = new Date().getDate();

  if (day >= 6 && day <= 12) {
    const daysLeft = 13 - day;
    return {
      show: true,
      message: t.auditLogPage.cleanupCountdown.replace('{days}', String(daysLeft)),
      isCleanupDay: false,
    };
  }

  if (day === 13) {
    return {
      show: true,
      message: t.auditLogPage.cleanupInProgress,
      isCleanupDay: true,
    };
  }

  return null;
}

const containerVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.02 },
  },
};

const rowVariants = {
  hidden: { opacity: 0, x: -12 },
  show: { opacity: 1, x: 0, transition: { type: 'spring' as const, stiffness: 350, damping: 25 } },
};

export default function AuditLog() {
  const { language, t } = useLanguage();
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionFilter, setActionFilter] = useState('');
  const [collectionFilter, setCollectionFilter] = useState('');
  const [searchText, setSearchText] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [userMap, setUserMap] = useState<Record<string, AuditUserLookup>>({});
  const [stats, setStats] = useState<AuditStats | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  // Compute stats from loaded logs (client-side)
  const computeStats = useCallback((allLogs: AuditLogEntry[]) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayISO = today.toISOString();
    const todayLogs = allLogs.filter((l) => l.timestamp >= todayISO);
    setStats({
      totalToday: todayLogs.length,
      loginsToday: todayLogs.filter((l) => l.action === 'login').length,
      changesToday: todayLogs.filter((l) => ['create', 'update', 'delete'].includes(l.action))
        .length,
      uniqueUsersToday: new Set(todayLogs.map((l) => l.userId)).size,
    });
  }, []);

  // Build PostgreSQL API query and subscribe with onSnapshot
  const fetchLogs = useCallback(
    async (append = false) => {
      setLoading(!append);
      if (append) setLoadingMore(true);

      const PAGE_SIZE = 100;
      try {
        const data = await readChannel<{
          logs: AuditLogEntry[];
          users?: Record<string, AuditUserLookup>;
          page?: { nextCursor?: string | null; hasMore?: boolean };
        }>('audit-log', {
          limit: PAGE_SIZE,
          actionFilter,
          collectionFilter,
          startDate,
          endDate,
          cursor: append ? cursor : undefined,
        });
        const newLogs = data.logs || [];
        if (append) {
          setLogs((prev) => [...prev, ...newLogs]);
        } else {
          setLogs(newLogs);
          computeStats(newLogs);
        }
        if (data.users) setUserMap((prev) => ({ ...prev, ...data.users }));
        setCursor(data.page?.nextCursor || null);
        setHasMore(Boolean(data.page?.hasMore));
      } catch (err) {
        console.error('Failed to fetch audit logs:', err);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [actionFilter, collectionFilter, startDate, endDate, cursor, computeStats]
  );

  // Re-fetch when filters change
  useEffect(() => {
    setCursor(null);
    fetchLogs(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionFilter, collectionFilter, startDate, endDate]);

  const filteredLogs = searchText
    ? logs.filter((l) => {
        const needle = searchText.toLowerCase();
        const actor = getUserParts(l.userId, userMap, l.userName, l.userRole);
        const target = formatTargetLabel(l, t, userMap);
        return [actor.name, actor.id, actor.role, l.userName, l.documentId, l.collection, target]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(needle));
      })
    : logs;

  const groups = groupByDate(filteredLogs, t, language);
  const uniqueCollections = [...new Set(logs.map((l) => l.collection))].sort();
  const cleanupInfo = getCleanupCountdown(t);

  const statCards = [
    {
      label: t.auditLogPage.todayActivity,
      value: stats?.totalToday ?? '—',
      icon: Activity,
      gradient: 'from-blue-500 to-blue-500',
    },
    {
      label: t.auditLogPage.loginsToday,
      value: stats?.loginsToday ?? '—',
      icon: LogIn,
      gradient: 'from-emerald-500 to-teal-500',
    },
    {
      label: t.auditLogPage.dataChanges,
      value: stats?.changesToday ?? '—',
      icon: Pencil,
      gradient: 'from-amber-500 to-orange-500',
    },
    {
      label: t.auditLogPage.activeUsers,
      value: stats?.uniqueUsersToday ?? '—',
      icon: Users,
      gradient: 'from-purple-500 to-pink-500',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/25">
            <Shield className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-heading">{t.auditLogPage.title}</h1>
            <p className="text-sm text-subtle">{t.auditLogPage.description}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => exportCSV(filteredLogs, t, language, userMap)}
            className="flex items-center gap-2 px-4 py-2 bg-surface border border-border-default rounded-lg hover:bg-surface-alt transition-colors text-sm"
            title={t.auditLogPage.exportCSV}
          >
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline">CSV</span>
          </button>
          <button
            onClick={() => {
              setCursor(null);
              fetchLogs(false);
            }}
            className="flex items-center gap-2 px-4 py-2 bg-surface border border-border-default rounded-lg hover:bg-surface-alt transition-colors text-sm"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            {t.auditLogPage.refresh}
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {statCards.map((card, i) => {
          const Icon = card.icon;
          return (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.08 }}
              className="bg-surface border border-border-default rounded-xl p-4 shadow-sm"
            >
              <div className="flex items-center justify-between mb-2">
                <div
                  className={`w-9 h-9 rounded-lg bg-gradient-to-br ${card.gradient} flex items-center justify-center shadow-sm`}
                >
                  <Icon className="w-4 h-4 text-white" />
                </div>
              </div>
              <p className="text-2xl font-bold text-heading">{card.value}</p>
              <p className="text-xs text-subtle mt-0.5">{card.label}</p>
            </motion.div>
          );
        })}
      </div>

      {/* Cleanup Countdown Banner */}
      <AnimatePresence>
        {cleanupInfo?.show && !bannerDismissed && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-800 p-4 rounded-2xl flex items-center justify-between gap-4"
          >
            <div className="flex items-center gap-3 text-amber-800 dark:text-amber-400">
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <p className="text-sm font-medium">{cleanupInfo.message}</p>
            </div>
            <button
              type="button"
              onClick={() => setBannerDismissed(true)}
              className="rounded-full p-1 text-amber-600 dark:text-amber-400 transition hover:bg-amber-100 dark:hover:bg-amber-500/20"
              aria-label={t.auditLogPage.dismissWarning}
            >
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Filters */}
      <div className="bg-surface border border-border-default rounded-xl p-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-subtle" />
            <select
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              className="px-3 py-2 bg-surface border border-border-default rounded-lg text-sm"
            >
              <option value="">{t.auditLogPage.allActions}</option>
              {Object.entries(t.auditLogPage.actions).map(([key, label]) => (
                <option key={key} value={key}>
                  {String(label)}
                </option>
              ))}
            </select>
          </div>
          <select
            value={collectionFilter}
            onChange={(e) => setCollectionFilter(e.target.value)}
            className="px-3 py-2 bg-surface border border-border-default rounded-lg text-sm"
          >
            <option value="">{t.auditLogPage.allCollections}</option>
            {uniqueCollections.map((c) => (
              <option key={c} value={c}>
                {String(t.auditLogPage.collections[c] || c)}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-subtle" />
            <ApiDateTextInput
              label={t.auditLogPage.from}
              hideLabel
              value={startDate}
              onChange={setStartDate}
              inputClassName="px-3 py-2 bg-surface border-border-default rounded-lg text-sm"
              placeholder={t.auditLogPage.from}
            />
            <span className="text-subtle text-sm">→</span>
            <ApiDateTextInput
              label={t.auditLogPage.to}
              hideLabel
              value={endDate}
              onChange={setEndDate}
              inputClassName="px-3 py-2 bg-surface border-border-default rounded-lg text-sm"
              placeholder={t.auditLogPage.to}
            />
          </div>
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-subtle" />
            <input
              type="text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder={t.auditLogPage.searchPlaceholder}
              className="w-full pl-9 pr-3 py-2 bg-surface border border-border-default rounded-lg text-sm"
            />
          </div>
        </div>
      </div>

      {/* Log Timeline */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <RefreshCw className="w-8 h-8 animate-spin text-blue-500" />
        </div>
      ) : filteredLogs.length === 0 ? (
        <div className="text-center py-20 text-subtle">
          <Search className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>{t.auditLogPage.noLogs}</p>
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <div key={group.label}>
              {/* Day Header */}
              <div className="flex items-center gap-3 mb-3">
                <div className="w-2 h-2 rounded-full bg-blue-500" />
                <h3 className="text-sm font-bold text-heading uppercase tracking-wider">
                  {group.label}
                </h3>
                <div className="flex-1 h-px bg-border-light" />
                <span className="text-xs text-subtle">
                  {group.logs.length} {t.auditLogPage.activities}
                </span>
              </div>

              {/* Log Entries */}
              <motion.div
                variants={containerVariants}
                initial="hidden"
                animate="show"
                className="space-y-2 ml-4 border-l-2 border-border-light pl-4"
              >
                {group.logs.map((log) => {
                  const ua = parseUserAgent(log.userAgent);
                  const time = new Date(log.timestamp);
                  const timeStr = time.toLocaleTimeString(localize(language, 'vi-VN', 'en-US'), {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  });
                  const isExpanded = expandedId === log.id;
                  const actor = getUserParts(log.userId, userMap, log.userName, log.userRole);
                  const target = getTargetParts(log, t, userMap);

                  return (
                    <motion.div
                      key={log.id}
                      variants={rowVariants}
                      whileHover={{
                        scale: 1.008,
                        backgroundColor: 'rgba(59, 130, 246, 0.02)',
                        boxShadow: '0 8px 30px rgba(59, 130, 246, 0.04)',
                        transition: { type: 'spring', stiffness: 400, damping: 25 },
                      }}
                      className="bg-surface border border-border-default rounded-lg overflow-hidden relative"
                    >
                      {/* Timeline dot */}
                      <div className="absolute -left-[22px] top-4 w-3 h-3 rounded-full bg-surface border-2 border-blue-400" />

                      <button
                        onClick={() => setExpandedId(isExpanded ? null : log.id)}
                        className="w-full flex items-start gap-3 px-4 py-3 hover:bg-surface-alt transition-colors text-left"
                      >
                        {/* Avatar */}
                        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-100 to-blue-200 dark:from-blue-500/20 dark:to-blue-600/20 text-blue-700 dark:text-blue-400 flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">
                          {(actor.name || actor.id || '?')[0]?.toUpperCase()}
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-semibold text-heading">
                              {actor.name || actor.id || '?'}
                            </span>
                            {actor.id && actor.name && actor.name !== actor.id && (
                              <span className="text-xs font-medium text-subtle">
                                ID: {actor.id}
                              </span>
                            )}
                            {actor.role && (
                              <span className="text-xs text-subtle capitalize">{actor.role}</span>
                            )}
                            <span
                              className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${ACTION_COLORS[log.action] || 'bg-gray-100 text-gray-700'}`}
                            >
                              {t.auditLogPage.actions[log.action] || log.action}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 mt-1 text-xs text-subtle flex-wrap">
                            <span className="font-medium text-body">{target.collectionName}</span>
                            <span className="text-subtle break-all">/{target.target}</span>
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {timeStr}
                            </span>
                            <span className="text-blue-500 dark:text-blue-400">
                              {relativeTime(log.timestamp, t)}
                            </span>
                            {log.ip && log.ip !== 'unknown' && (
                              <span className="flex items-center gap-1">
                                <Globe className="w-3 h-3" />
                                {log.ip}
                              </span>
                            )}
                            {log.userAgent && (
                              <span className="flex items-center gap-1 hidden sm:flex">
                                <Monitor className="w-3 h-3" />
                                {ua.label}
                              </span>
                            )}
                          </div>
                        </div>

                        {isExpanded ? (
                          <ChevronUp className="w-4 h-4 text-subtle shrink-0 mt-1" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-subtle shrink-0 mt-1" />
                        )}
                      </button>

                      <AnimatePresence>
                        {isExpanded && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="overflow-hidden"
                          >
                            <div className="px-4 pb-4 border-t border-border-light">
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3 text-xs">
                                <DetailRow
                                  label={t.auditLogPage.user}
                                  value={formatUserLabel(log.userId, userMap, log.userName)}
                                />
                                <DetailRow label={t.auditLogPage.role} value={actor.role} />
                                <DetailRow
                                  label={t.auditLogPage.timestamp}
                                  value={new Date(log.timestamp).toLocaleString(
                                    localize(language, 'vi-VN', 'en-US')
                                  )}
                                />
                                <DetailRow label={t.auditLogPage.userId} value={log.userId} />
                                <DetailRow
                                  label={t.auditLogPage.target}
                                  value={formatTargetLabel(log, t, userMap)}
                                />
                                {log.ip && (
                                  <DetailRow
                                    label="IP"
                                    value={log.ip}
                                    icon={<Globe className="w-3 h-3" />}
                                  />
                                )}
                                {log.userAgent && (
                                  <DetailRow
                                    label={t.auditLogPage.device}
                                    value={ua.label}
                                    icon={<Monitor className="w-3 h-3" />}
                                  />
                                )}

                                {log.metadata && (
                                  <div className="col-span-full">
                                    <span className="text-subtle">{t.auditLogPage.details}: </span>
                                    <pre className="text-heading bg-surface-alt p-2 rounded mt-1 overflow-x-auto text-[11px]">
                                      {JSON.stringify(log.metadata, null, 2)}
                                    </pre>
                                  </div>
                                )}

                                {log.changes && Object.keys(log.changes).length > 0 && (
                                  <div className="col-span-full">
                                    <span className="text-subtle">{t.auditLogPage.changes}: </span>
                                    <div className="bg-surface-alt p-2 rounded mt-1 overflow-x-auto text-xs space-y-1">
                                      {Object.entries(log.changes).map(([field, change]) => {
                                        return (
                                          <div key={field} className="flex gap-2">
                                            <span className="font-medium text-heading shrink-0">
                                              {field}:
                                            </span>
                                            <span className="text-red-600 line-through">
                                              {resolveAuditValue(change.before, userMap)}
                                            </span>
                                            <span className="text-subtle">→</span>
                                            <span className="text-emerald-600">
                                              {resolveAuditValue(change.after, userMap)}
                                            </span>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                )}

                                {log.userAgent && (
                                  <div className="col-span-full">
                                    <span className="text-subtle">User Agent: </span>
                                    <code className="text-[10px] text-body break-all">
                                      {log.userAgent}
                                    </code>
                                  </div>
                                )}
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </motion.div>
                  );
                })}
              </motion.div>
            </div>
          ))}

          {/* Load More */}
          {hasMore && (
            <div className="text-center pt-4">
              <button
                onClick={() => fetchLogs(true)}
                disabled={loadingMore}
                className="px-6 py-2.5 bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-500/20 transition-colors text-sm font-medium disabled:opacity-50"
              >
                {loadingMore ? <RefreshCw className="w-4 h-4 animate-spin inline mr-2" /> : null}
                {t.auditLogPage.loadMore}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DetailRow({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
}) {
  return (
    <div>
      <span className="text-subtle flex items-center gap-1">
        {icon}
        {label}:{' '}
      </span>
      <span className="text-heading font-medium">{value}</span>
    </div>
  );
}
