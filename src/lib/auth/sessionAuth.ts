export type SessionProvider = {
  providerId: string;
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
};

export type SessionUser = {
  uid: string;
  email: string | null;
  displayName: string | null;
  bio?: string | null;
  phone?: string | null;
  faceImage?: string | null;
  role?: 'teacher' | 'student' | 'parent' | 'admin' | 'accounting' | 'office';
  studentId?: string | null;
  classId?: string | null;
  teacherId?: string | null;
  forcePasswordChange?: boolean;
  emailVerified: boolean;
  isAnonymous: boolean;
  tenantId: string | null;
  providerData: SessionProvider[];
};

type SessionPayload = {
  user?: Partial<SessionUser> | null;
  profile?: {
    uid?: string;
    id?: string;
    email?: string | null;
    displayName?: string | null;
  } | null;
};

type SessionListener = (user: SessionUser | null) => void;

function normalizeSessionUser(payload: SessionPayload): SessionUser | null {
  const source = payload.user || payload.profile;
  if (!source) return null;
  const identity = source as { uid?: string; id?: string };
  const uid = String(identity.uid || identity.id || '').trim();
  if (!uid) return null;
  const email = typeof source.email === 'string' ? source.email : null;
  const displayName = typeof source.displayName === 'string' ? source.displayName : null;
  const user = payload.user;
  return {
    uid,
    email,
    displayName,
    bio: typeof user?.bio === 'string' ? user.bio : null,
    phone: typeof user?.phone === 'string' ? user.phone : null,
    faceImage: typeof user?.faceImage === 'string' ? user.faceImage : null,
    role: user?.role,
    studentId: user?.studentId ?? null,
    classId: user?.classId ?? null,
    teacherId: user?.teacherId ?? null,
    forcePasswordChange: user?.forcePasswordChange ?? false,
    emailVerified: user?.emailVerified ?? Boolean(email),
    isAnonymous: user?.isAnonymous ?? false,
    tenantId: user?.tenantId ?? null,
    providerData: Array.isArray(user?.providerData) ? user.providerData : [],
  };
}

class SessionAuthClient {
  currentUser: SessionUser | null = null;
  private listeners = new Set<SessionListener>();
  private refreshPromise: Promise<SessionUser | null> | null = null;

  subscribe(listener: SessionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private publish(user: SessionUser | null) {
    this.currentUser = user;
    for (const listener of this.listeners) listener(user);
  }

  async refresh(): Promise<SessionUser | null> {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = (async () => {
      try {
        const response = await fetch('/api/v1/auth/session', {
          method: 'GET',
          credentials: 'same-origin',
          headers: { Accept: 'application/json' },
        });
        if (response.status === 401) {
          this.publish(null);
          return null;
        }
        const data = (await response.json().catch(() => ({}))) as SessionPayload & {
          success?: boolean;
          error?: string;
        };
        if (!response.ok || data.success === false) {
          throw new Error(data.error || `Session request failed (${response.status})`);
        }
        const user = normalizeSessionUser(data);
        this.publish(user);
        return user;
      } finally {
        this.refreshPromise = null;
      }
    })();
    return this.refreshPromise;
  }

  async signOut(): Promise<void> {
    try {
      await fetch('/api/v1/auth/session-logout', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: '{}',
      });
    } finally {
      this.publish(null);
    }
  }
}

export const auth = new SessionAuthClient();
