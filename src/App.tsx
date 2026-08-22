import React, { Suspense, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import { BrowserRouter as Router, useLocation } from 'react-router';
import { cn } from './lib/core/utils';
import { ChangePasswordModal } from './components/auth/ChangePasswordModal';
import { BlockedModal } from './components/auth/BlockedModal';
import LoadingScreen from './components/common/LoadingScreen';
import { useAuth } from './contexts/AuthContext';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { AnimatedRoutes } from './app/AnimatedRoutes';
import { AppHeader } from './app/AppHeader';
import { Sidebar } from './app/Sidebar';
import { isMaintenanceModeEnabled } from './app/maintenanceMode';
import { usePendingPrintRequests } from './app/usePendingPrintRequests';
import { BlockDevToolGuard } from './app/BlockDevToolGuard';
import MaintenancePage from './pages/common/MaintenancePage';
import { OfficeInvalidationBridge } from './lib/office/OfficeInvalidationBridge';
import {
  BLOCK_DEV_TOOL_ATTEMPT_EVENT,
  type BlockDevToolAttempt,
} from './hooks/useBlockDevToolGuard';

const getInitialSidebarOpen = () => {
  if (typeof window === 'undefined') return true;
  return window.matchMedia('(min-width: 1024px)').matches;
};

const BLOCK_DEV_TOOL_PATH = '/blockdevtool';
const queryClient = new QueryClient();

function AppContent() {
  const { user, profile, loading, signOut } = useAuth();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(getInitialSidebarOpen);
  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;

    const mediaQuery = window.matchMedia('(min-width: 1024px)');
    const handleChange = (event: MediaQueryListEvent) => {
      setSidebarOpen(event.matches);
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  React.useEffect(() => {
    const handleOpenChangePassword = () => setIsChangePasswordOpen(true);
    document.addEventListener('open-change-password', handleOpenChangePassword);
    return () => document.removeEventListener('open-change-password', handleOpenChangePassword);
  }, []);

  React.useEffect(() => {
    if (profile?.forcePasswordChange) {
      setIsChangePasswordOpen(true);
    }
  }, [profile?.forcePasswordChange]);

  const handleSignOut = async () => {
    if (isSigningOut) return;
    setIsSigningOut(true);
    try {
      await signOut();
      window.location.href = '/login';
    } finally {
      setIsSigningOut(false);
    }
  };

  const isParent = profile?.role === 'parent';
  const shouldBlockDevTools = profile?.role !== 'admin';
  const isBlockDevToolPage = location.pathname === BLOCK_DEV_TOOL_PATH;
  const pendingPrintRequests = usePendingPrintRequests(user, profile);

  const handleBlockedDevToolAttempt = (attempt: BlockDevToolAttempt) => {
    const event = new CustomEvent(BLOCK_DEV_TOOL_ATTEMPT_EVENT, {
      cancelable: true,
      detail: attempt,
    });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  };

  const isMaintenanceMode = isMaintenanceModeEnabled();

  if (isMaintenanceMode && !isBlockDevToolPage) {
    return (
      <>
        <BlockDevToolGuard
          enabled={shouldBlockDevTools}
          onBlockedAttempt={handleBlockedDevToolAttempt}
        />
        <Toaster position="top-center" reverseOrder={false} containerStyle={{ zIndex: 1150 }} />
        <BlockedModal />
        <MaintenancePage />
      </>
    );
  }

  return (
    <>
      <BlockDevToolGuard
        enabled={shouldBlockDevTools}
        onBlockedAttempt={handleBlockedDevToolAttempt}
      />
      <Toaster position="top-center" reverseOrder={false} containerStyle={{ zIndex: 1150 }} />
      <BlockedModal />
      <OfficeInvalidationBridge uid={user?.uid} role={profile?.role} />
      {loading ? (
        <LoadingScreen />
      ) : (
        <ErrorBoundary>
          <div className="flex min-h-screen app-shell-background">
            {user && profile && !isBlockDevToolPage && (
              <div
                className={cn(
                  'app-sidebar-layer flex-shrink-0 transition-all duration-300',
                  profile.role === 'parent' ? 'hidden lg:flex' : ''
                )}
              >
                <Sidebar
                  isOpen={sidebarOpen}
                  setIsOpen={setSidebarOpen}
                  profile={profile}
                  onSignOut={handleSignOut}
                  isSigningOut={isSigningOut}
                  pendingPrintRequests={pendingPrintRequests}
                />
              </div>
            )}

            <main
              className={cn(
                'app-main-layer flex-1 flex flex-col min-w-0',
                isBlockDevToolPage && 'min-h-screen'
              )}
            >
              {user && profile && !isBlockDevToolPage && (
                <AppHeader
                  user={user}
                  profile={profile}
                  sidebarOpen={sidebarOpen}
                  setSidebarOpen={setSidebarOpen}
                />
              )}

              <div
                data-scroll-lock-container
                className={cn(
                  'flex-1 overflow-y-auto',
                  isBlockDevToolPage ? 'p-0' : cn('lg:p-8', isParent ? 'p-0' : 'p-4')
                )}
              >
                <Suspense fallback={<LoadingScreen />}>
                  <AnimatedRoutes user={user} profile={profile} />
                </Suspense>
              </div>
            </main>
          </div>
        </ErrorBoundary>
      )}
      {profile && (
        <ChangePasswordModal
          isOpen={isChangePasswordOpen}
          onClose={() => setIsChangePasswordOpen(false)}
          profile={profile}
          isForced={profile.forcePasswordChange}
        />
      )}
    </>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Router>
        <AppContent />
      </Router>
    </QueryClientProvider>
  );
}
