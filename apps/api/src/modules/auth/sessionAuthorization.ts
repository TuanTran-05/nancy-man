import { createHash } from 'node:crypto';

import {
  deriveCsrfSecret,
  verifyCsrfToken,
  type OpsRole
} from '../../../../../packages/security/src/sessions.js';

type SessionRecord = {
  id: string;
  userId: string;
  csrfSecretHash: string;
  role: OpsRole;
  username?: string;
  displayName?: string;
};

function sessionToken(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  const item = cookieHeader
    .split(';')
    .map((value) => value.trim())
    .find((value) => value.startsWith('__Host-ops-session='));
  const token = item?.slice('__Host-ops-session='.length);
  return token && /^[A-Za-z0-9_-]{32,256}$/.test(token) ? token : null;
}

export async function authorizeOpsSession(input: {
  cookieHeader?: string;
  csrfToken?: string;
  mutation: boolean;
  sessionPepper: string;
  repository: { findActiveByToken: (token: string) => Promise<SessionRecord | null> };
}): Promise<{
  sessionId: string;
  userId: string;
  role: OpsRole;
  username?: string;
  displayName?: string;
} | null> {
  const token = sessionToken(input.cookieHeader);
  if (!token) return null;
  const session = await input.repository.findActiveByToken(token);
  if (!session) return null;
  const csrfSecret = deriveCsrfSecret({ sessionToken: token, csrfPepper: input.sessionPepper });
  if (createHash('sha256').update(csrfSecret, 'utf8').digest('hex') !== session.csrfSecretHash)
    return null;
  if (
    input.mutation &&
    (!input.csrfToken ||
      !verifyCsrfToken({ sessionId: session.id, csrfSecret, csrfToken: input.csrfToken }))
  )
    return null;
  return {
    sessionId: session.id,
    userId: session.userId,
    role: session.role,
    ...(session.username ? { username: session.username } : {}),
    ...(session.displayName ? { displayName: session.displayName } : {})
  };
}
