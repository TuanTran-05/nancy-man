import type { BlockDevToolAttempt } from '../hooks/useBlockDevToolGuard';
import { useBlockDevToolGuard } from '../hooks/useBlockDevToolGuard';

export function BlockDevToolGuard({
  enabled,
  onBlockedAttempt,
}: {
  enabled: boolean;
  onBlockedAttempt?: (attempt: BlockDevToolAttempt) => boolean;
}) {
  useBlockDevToolGuard({ enabled, onBlockedAttempt });
  return null;
}
