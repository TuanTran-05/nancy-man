import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';

const BLOCK_DEV_TOOL_PATH = '/blockdevtool';
const RETURN_PATH_KEY = 'edutrack:blockdevtool:returnPath';

export const BLOCK_DEV_TOOL_ATTEMPT_EVENT = 'edutrack:blockdevtool-attempt';

export type BlockDevToolTrigger = 'keyboard' | 'contextmenu';

export interface BlockDevToolAttempt {
  trigger: BlockDevToolTrigger;
  key?: string;
  returnPath: string;
}

type BlockDevToolGuardOptions = {
  enabled?: boolean;
  onBlockedAttempt?: (attempt: BlockDevToolAttempt) => boolean;
};

function isBlockedKeyboardShortcut(event: KeyboardEvent) {
  // Extensions and browser tooling can dispatch a generic `keydown` Event
  // without the KeyboardEvent `key` field. The guard runs in the capture
  // phase, so throwing here breaks unrelated controls (including filters)
  // before their own handlers receive the event.
  const rawKey = typeof event.key === 'string' ? event.key : '';
  const key = rawKey.toLowerCase();
  const hasModifier = event.ctrlKey || event.metaKey;
  const devToolPanelShortcut = key === 'i' || key === 'j' || key === 'c' || key === 'k';

  if (rawKey === 'F12') return true;
  if (hasModifier && event.shiftKey && devToolPanelShortcut) return true;
  if (hasModifier && event.altKey && devToolPanelShortcut) return true;
  if (hasModifier && key === 'u') return true;

  return false;
}

export function useBlockDevToolGuard({
  enabled = true,
  onBlockedAttempt,
}: BlockDevToolGuardOptions = {}) {
  const navigate = useNavigate();
  const location = useLocation();
  const locationRef = useRef(location);

  useEffect(() => {
    locationRef.current = location;
  }, [location]);

  useEffect(() => {
    if (!enabled) return;

    const openBlockPage = (attempt: Omit<BlockDevToolAttempt, 'returnPath'>) => {
      const current = locationRef.current;
      if (current.pathname === BLOCK_DEV_TOOL_PATH) return;

      const returnPath = `${current.pathname}${current.search}${current.hash}`;
      const handled = onBlockedAttempt?.({ ...attempt, returnPath }) === true;
      if (handled) return;

      try {
        window.sessionStorage.setItem(RETURN_PATH_KEY, returnPath);
      } catch {
        // Session storage can be unavailable in hardened/private browser contexts.
      }
      navigate(BLOCK_DEV_TOOL_PATH);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isBlockedKeyboardShortcut(event)) return;
      event.preventDefault();
      event.stopPropagation();
      openBlockPage({ trigger: 'keyboard', key: event.key });
    };

    const handleContextMenu = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      openBlockPage({ trigger: 'contextmenu' });
    };

    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('contextmenu', handleContextMenu, true);

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('contextmenu', handleContextMenu, true);
    };
  }, [enabled, navigate, onBlockedAttempt]);
}

export function getBlockDevToolReturnPath() {
  try {
    return window.sessionStorage.getItem(RETURN_PATH_KEY) || '/';
  } catch {
    return '/';
  }
}
