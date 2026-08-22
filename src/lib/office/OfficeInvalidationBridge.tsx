import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { FRONTEND_READ_POLL_INTERVAL_MS } from '../api/frontendReadApi';

const BRIDGE_ROLES = new Set(['office', 'admin']);
export const OFFICE_BRIDGE_DEBOUNCE_MS = 400;

/**
 * Keeps mounted office/admin queries fresh through HTTP polling.
 * HTTP queries own their own authorization and the bridge only invalidates
 * cached reads when the app is visible.
 */
export function OfficeInvalidationBridge({
  uid,
  role,
}: {
  uid?: string | null;
  role?: string | null;
}) {
  const queryClient = useQueryClient();
  const enabled = Boolean(uid) && BRIDGE_ROLES.has(role || '');
  const previousIdentityRef = useRef<string | null>(null);

  useEffect(() => {
    const identity = uid ? `${uid}:${role || ''}` : null;
    const previous = previousIdentityRef.current;
    previousIdentityRef.current = identity;
    if (previous !== null && previous !== identity) queryClient.clear();
  }, [uid, role, queryClient]);

  useEffect(() => {
    if (!enabled) return;

    const refresh = () => {
      if (document.visibilityState === 'visible') {
        void queryClient.invalidateQueries({ queryKey: ['office'] });
        void queryClient.invalidateQueries({ queryKey: ['read'] });
      }
    };
    const interval = window.setInterval(refresh, FRONTEND_READ_POLL_INTERVAL_MS);
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
    };
  }, [enabled, queryClient]);

  return null;
}

export default OfficeInvalidationBridge;
