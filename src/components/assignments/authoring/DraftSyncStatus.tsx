import { AlertTriangle, CheckCircle2, Cloud, CloudOff, Loader2 } from 'lucide-react';
import type { AuthoringSyncStatus } from './authoringState';

interface DraftSyncStatusProps {
  status: AuthoringSyncStatus;
}

export function DraftSyncStatus({ status }: DraftSyncStatusProps) {
  const config = {
    idle: { label: 'Not saved yet', icon: Cloud, className: 'text-slate-500' },
    local_pending: { label: 'Saved locally', icon: CloudOff, className: 'text-amber-700' },
    syncing: { label: 'Saving...', icon: Loader2, className: 'text-blue-700' },
    synced: { label: 'Saved', icon: CheckCircle2, className: 'text-emerald-700' },
    offline: { label: 'Offline draft', icon: CloudOff, className: 'text-amber-700' },
    conflict: { label: 'Sync conflict', icon: AlertTriangle, className: 'text-red-700' },
  }[status];
  const Icon = config.icon;
  return (
    <div
      aria-live="polite"
      className={`inline-flex items-center gap-2 text-sm font-bold ${config.className}`}
    >
      <Icon className={`h-4 w-4 ${status === 'syncing' ? 'animate-spin' : ''}`} />
      {config.label}
    </div>
  );
}
