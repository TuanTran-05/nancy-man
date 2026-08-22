import React from 'react';
import type { PrintRequest, UserProfile } from '../types';
import { readChannel } from '../lib/api/readApi';
import { FRONTEND_READ_POLL_INTERVAL_MS } from '../lib/api/frontendReadApi';

export function usePendingPrintRequests(user: any, profile: UserProfile | null) {
  const [pendingCount, setPendingCount] = React.useState(0);

  React.useEffect(() => {
    if (!user || profile?.role !== 'office') {
      setPendingCount(0);
      return;
    }

    let active = true;
    const refresh = async () => {
      try {
        const payload = await readChannel<{ requests: PrintRequest[] }>('print-requests', {
          status: 'pending',
        });
        if (active) setPendingCount((payload.requests || []).length);
      } catch (error) {
        console.error('Pending print requests read error:', error);
        if (!active) return;
        setPendingCount(0);
      }
    };

    void refresh();
    const interval = window.setInterval(() => void refresh(), FRONTEND_READ_POLL_INTERVAL_MS);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [user?.uid, profile?.role]);

  return pendingCount;
}
