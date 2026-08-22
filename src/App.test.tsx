// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { CENTER_LOGO_URL } from './lib/brand';

const authState = vi.hoisted(() => ({
  current: {
    user: { uid: 'admin-1' } as { uid: string } | null,
    profile: { uid: 'admin-1', role: 'admin', displayName: 'Admin' } as {
      uid: string;
      role: string;
      displayName: string;
    } | null,
    loading: false,
    signOut: vi.fn(),
  },
}));

const blockDevToolGuardState = vi.hoisted(() => ({
  calls: [] as Array<{
    enabled: boolean;
    onBlockedAttempt?: (attempt: { returnPath: string }) => boolean;
  }>,
}));

const maintenanceModeState = vi.hoisted(() => ({
  enabled: false,
}));

const queryClientProbeState = vi.hoisted(() => ({
  enabled: false,
}));

vi.mock('react-hot-toast', () => ({
  Toaster: () => null,
}));

vi.mock('./contexts/AuthContext', () => ({
  useAuth: () => authState.current,
}));

vi.mock('./components/auth/BlockedModal', () => ({
  BlockedModal: () => null,
}));

vi.mock('./components/auth/ChangePasswordModal', () => ({
  ChangePasswordModal: () => null,
}));

vi.mock('./components/common/LoadingScreen', () => ({
  default: () => <div>Loading</div>,
}));

vi.mock('./app/maintenanceMode', () => ({
  MAINTENANCE_WINDOW_LABEL: '16:00 ngày 16/07 đến 24:00 ngày 16/07',
  isMaintenanceModeEnabled: () => maintenanceModeState.enabled,
}));

vi.mock('./app/BlockDevToolGuard', () => ({
  BlockDevToolGuard: (props: {
    enabled: boolean;
    onBlockedAttempt?: (attempt: { returnPath: string }) => boolean;
  }) => {
    blockDevToolGuardState.calls.push(props);
    return <div data-testid="block-devtool-guard" data-enabled={String(props.enabled)} />;
  },
}));

vi.mock('./app/Sidebar', () => ({
  Sidebar: () => <aside data-testid="app-sidebar">Sidebar</aside>,
}));

vi.mock('./app/AppHeader', () => ({
  AppHeader: () => <header data-testid="app-header">Header</header>,
}));

vi.mock('./app/AnimatedRoutes', async () => {
  const { useQueryClient } =
    await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');

  function QueryClientProbe() {
    useQueryClient();
    return <div data-testid="query-client-ready">Query client ready</div>;
  }

  return {
    AnimatedRoutes: () =>
      queryClientProbeState.enabled ? (
        <QueryClientProbe />
      ) : (
        <div data-testid="animated-routes">Routes</div>
      ),
  };
});

vi.mock('./app/usePendingPrintRequests', () => ({
  usePendingPrintRequests: () => 0,
}));

describe('App blockdevtool chrome', () => {
  beforeEach(() => {
    authState.current = {
      user: { uid: 'admin-1' },
      profile: { uid: 'admin-1', role: 'admin', displayName: 'Admin' },
      loading: false,
      signOut: vi.fn(),
    };
    blockDevToolGuardState.calls.length = 0;
    maintenanceModeState.enabled = false;
    queryClientProbeState.enabled = false;
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: true,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    window.history.pushState({}, '', '/');
  });

  it('keeps the normal app shell on regular authenticated routes', () => {
    window.history.pushState({}, '', '/knowledge-bank');

    render(<App />);

    expect(screen.getByTestId('app-sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('app-header')).toBeInTheDocument();
    expect(screen.getByTestId('animated-routes')).toBeInTheDocument();
  });

  it('provides a Query Client to routed pages', () => {
    queryClientProbeState.enabled = true;

    render(<App />);

    expect(screen.getByTestId('query-client-ready')).toBeInTheDocument();
  });

  it('shows the maintenance page instead of the app shell on every route while maintenance mode is enabled', () => {
    window.history.pushState({}, '', '/knowledge-bank');
    maintenanceModeState.enabled = true;

    render(<App />);

    expect(screen.getByRole('heading', { name: /hệ thống đang bảo trì/i })).toBeInTheDocument();
    expect(screen.getByText(/16:00 ngày 16\/07 đến 24:00 ngày 16\/07/i)).toBeInTheDocument();
    expect(screen.getByTestId('maintenance-logo')).toHaveAttribute('src', CENTER_LOGO_URL);
    expect(screen.getByTestId('maintenance-logo')).toHaveAttribute(
      'alt',
      'Thiên Uy English Center'
    );
    expect(screen.queryByTestId('app-sidebar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('app-header')).not.toBeInTheDocument();
    expect(screen.queryByTestId('animated-routes')).not.toBeInTheDocument();
  });

  it('keeps the blockdevtool guard active while maintenance mode is enabled', () => {
    window.history.pushState({}, '', '/knowledge-bank');
    maintenanceModeState.enabled = true;
    authState.current = {
      user: null,
      profile: null,
      loading: false,
      signOut: vi.fn(),
    };

    render(<App />);

    expect(screen.getByTestId('block-devtool-guard')).toHaveAttribute('data-enabled', 'true');
    expect(screen.getByTestId('maintenance-logo')).toBeInTheDocument();
  });

  it('keeps the blockdevtool route reachable while maintenance mode is enabled', () => {
    window.history.pushState({}, '', '/blockdevtool');
    maintenanceModeState.enabled = true;

    render(<App />);

    expect(screen.getByTestId('block-devtool-guard')).toBeInTheDocument();
    expect(screen.getByTestId('animated-routes')).toBeInTheDocument();
    expect(screen.queryByTestId('maintenance-logo')).not.toBeInTheDocument();
    expect(screen.queryByTestId('app-sidebar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('app-header')).not.toBeInTheDocument();
  });

  it('hides the sidebar and header on the blockdevtool route', () => {
    window.history.pushState({}, '', '/blockdevtool');

    render(<App />);

    expect(screen.queryByTestId('app-sidebar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('app-header')).not.toBeInTheDocument();
    expect(screen.getByTestId('animated-routes')).toBeInTheDocument();
  });

  it('disables the blockdevtool guard for admin users', () => {
    render(<App />);

    expect(screen.getByTestId('block-devtool-guard')).toHaveAttribute('data-enabled', 'false');
    expect(blockDevToolGuardState.calls.at(-1)?.enabled).toBe(false);
  });

  it('enables the blockdevtool guard for non-admin users', () => {
    authState.current = {
      user: { uid: 'teacher-1' },
      profile: { uid: 'teacher-1', role: 'teacher', displayName: 'Teacher' },
      loading: false,
      signOut: vi.fn(),
    };

    render(<App />);

    expect(screen.getByTestId('block-devtool-guard')).toHaveAttribute('data-enabled', 'true');
    expect(blockDevToolGuardState.calls.at(-1)?.enabled).toBe(true);
  });

  it('enables the blockdevtool guard on the login page before a role is known', () => {
    window.history.pushState({}, '', '/login');
    authState.current = {
      user: null,
      profile: null,
      loading: false,
      signOut: vi.fn(),
    };

    render(<App />);

    expect(screen.getByTestId('block-devtool-guard')).toHaveAttribute('data-enabled', 'true');
    expect(blockDevToolGuardState.calls.at(-1)?.enabled).toBe(true);
  });

  it('dispatches devtools attempts for active assignment handlers', () => {
    const listener = vi.fn((event: Event) => {
      const detail = (event as CustomEvent).detail;
      expect(detail.returnPath).toBe('/assignments');
      event.preventDefault();
    });
    window.addEventListener('edutrack:blockdevtool-attempt', listener);
    window.history.pushState({}, '', '/assignments');

    render(<App />);

    const handled = blockDevToolGuardState.calls.at(-1)?.onBlockedAttempt?.({
      returnPath: '/assignments',
    });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(handled).toBe(true);

    window.removeEventListener('edutrack:blockdevtool-attempt', listener);
  });
});
