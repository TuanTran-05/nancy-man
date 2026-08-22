import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { auth } from '../lib/auth/sessionAuth';
import type { SessionUser } from '../lib/auth/sessionAuth';
import { SafeStudent, UserProfile } from '../types';
import { readChannel } from '../lib/api/readApi';
import { getLinkedStudentAccessBlock } from '../../shared/studentLifecycle';

interface AuthContextType {
  user: SessionUser | null;
  profile: UserProfile | null;
  loading: boolean;
  isAuthReady: boolean;
  blockedInfo: {
    email: string;
    reason: 'not_allowed' | 'revoked' | 'dropped_student' | 'dropped_parent';
  } | null;
  setBlockedInfo: (
    info: {
      email: string;
      reason: 'not_allowed' | 'revoked' | 'dropped_student' | 'dropped_parent';
    } | null
  ) => void;
  updateProfileState: (patch: CachedProfilePatch) => void;
  signOut: () => Promise<void>;
}

/** The only profile fields that may be patched optimistically by the UI. */
export type CachedProfilePatch = Partial<
  Pick<UserProfile, 'displayName' | 'faceImage' | 'bio' | 'phone'>
>;

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const STUDENT_SESSION_CHECK_INTERVAL_MS = 5 * 60 * 1000;
const PROFILE_SESSION_CHECK_INTERVAL_MS = 60 * 1000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [blockedInfo, setBlockedInfo] = useState<{
    email: string;
    reason: 'not_allowed' | 'revoked' | 'dropped_student' | 'dropped_parent';
  } | null>(null);

  useEffect(() => {
    let studentSessionCheck: number | undefined;
    let profileSessionCheck: number | undefined;
    let cancelled = false;

    const clearStudentSessionCheck = () => {
      if (studentSessionCheck !== undefined) {
        window.clearInterval(studentSessionCheck);
        studentSessionCheck = undefined;
      }
    };

    const clearProfileSessionCheck = () => {
      if (profileSessionCheck !== undefined) {
        window.clearInterval(profileSessionCheck);
        profileSessionCheck = undefined;
      }
    };

    const applySessionStudent = (userData: UserProfile, studentData: Partial<SafeStudent>) => {
      const role = userData.role === 'parent' ? 'parent' : 'student';
      const block = getLinkedStudentAccessBlock(studentData, role);
      if (block) {
        setBlockedInfo({
          email: studentData.name || 'Student',
          reason: block.reason === 'inactive_lifecycle' ? 'revoked' : block.reason,
        });
      }

      setProfile((previous) =>
        previous
          ? {
              ...previous,
              displayName: studentData.name || previous.displayName,
              classId: studentData.classId || previous.classId,
              teacherId: studentData.teacherId || previous.teacherId,
              faceImage: studentData.faceImage || previous.faceImage,
              faceImageStoragePath:
                studentData.faceImageStoragePath || previous.faceImageStoragePath,
              forcePasswordChange:
                userData.role === 'parent'
                  ? studentData.parentForcePasswordChange || false
                  : studentData.forcePasswordChange || false,
              enrollmentStatus: studentData.enrollmentStatus,
              statusChangedAt: studentData.statusChangedAt,
            }
          : null
      );
    };

    const loadSessionStudent = async (sessionUser: SessionUser, userData: UserProfile) => {
      try {
        const data = await readChannel<{ students: SafeStudent[] }>('students', {
          view: 'session',
        });
        const studentData = data.students[0];
        if (!cancelled && auth.currentUser?.uid === sessionUser.uid && studentData) {
          applySessionStudent(userData, studentData);
        }
      } catch (error) {
        if ((error as { status?: number }).status === 403) {
          setBlockedInfo({
            email: userData.displayName || sessionUser.email || 'Student',
            reason: 'revoked',
          });
          return;
        }
        console.error('Error loading student session data:', error);
      }
    };

    async function loadSessionProfile(sessionUser: SessionUser): Promise<void> {
      try {
        if (cancelled || auth.currentUser?.uid !== sessionUser.uid) return;
        if (!sessionUser.role) throw new Error('Session response is missing the account role');

        const userData: UserProfile = {
          uid: sessionUser.uid,
          email: sessionUser.email || undefined,
          displayName: sessionUser.displayName || undefined,
          bio: sessionUser.bio || undefined,
          phone: sessionUser.phone || undefined,
          faceImage: sessionUser.faceImage || undefined,
          role: sessionUser.role,
          studentId: sessionUser.studentId || undefined,
          classId: sessionUser.classId || undefined,
          teacherId: sessionUser.teacherId || undefined,
          forcePasswordChange: Boolean(sessionUser.forcePasswordChange),
        };
        setProfile(userData);
        localStorage.setItem('edu_user_displayName', userData.displayName || '');

        clearStudentSessionCheck();
        if (
          (userData.role === 'student' || userData.role === 'parent') &&
          userData.studentId
        ) {
          await loadSessionStudent(sessionUser, userData);
          studentSessionCheck = window.setInterval(() => {
            void loadSessionStudent(sessionUser, userData);
          }, STUDENT_SESSION_CHECK_INTERVAL_MS);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error('Error applying session profile:', errorMessage);
        setProfile(null);
        localStorage.removeItem('edu_user_displayName');
      } finally {
        if (!cancelled && auth.currentUser?.uid === sessionUser.uid) {
          setLoading(false);
          setIsAuthReady(true);
        }
      }
    }

    const unsubscribeAuth = auth.subscribe((sessionUser) => {
      setUser(sessionUser);
      clearStudentSessionCheck();
      clearProfileSessionCheck();

      if (sessionUser) {
        setLoading(true);
        void loadSessionProfile(sessionUser);
        profileSessionCheck = window.setInterval(() => {
          void auth.refresh();
        }, PROFILE_SESSION_CHECK_INTERVAL_MS);
      } else {
        setProfile(null);
        localStorage.removeItem('edu_user_displayName');
        setLoading(false);
        setIsAuthReady(true);
      }
    });
    void auth.refresh().catch((error) => {
      if (cancelled) return;
      console.error('Unable to restore the signed-in session:', error);
      setUser(null);
      setProfile(null);
      setLoading(false);
      setIsAuthReady(true);
    });

    return () => {
      cancelled = true;
      unsubscribeAuth();
      clearStudentSessionCheck();
      clearProfileSessionCheck();
    };
  }, []);

  const updateProfileState = (patch: CachedProfilePatch) => {
    setProfile((previous) => {
      if (!previous) return null;
      const next: UserProfile = { ...previous };
      if (patch.displayName !== undefined) next.displayName = patch.displayName;
      if (patch.faceImage !== undefined) next.faceImage = patch.faceImage;
      if (patch.bio !== undefined) next.bio = patch.bio;
      if (patch.phone !== undefined) next.phone = patch.phone;
      if (patch.displayName !== undefined) {
        localStorage.setItem('edu_user_displayName', patch.displayName || '');
      }
      return next;
    });
  };

  const signOut = async () => {
    localStorage.removeItem('edu_user_displayName');
    localStorage.removeItem('edu_student_session');
    await auth.signOut();
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        loading,
        isAuthReady,
        blockedInfo,
        setBlockedInfo,
        updateProfileState,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
