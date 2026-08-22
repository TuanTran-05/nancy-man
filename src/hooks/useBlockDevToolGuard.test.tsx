// @vitest-environment jsdom
import { useEffect } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BlockDevToolPage from '../pages/common/BlockDevToolPage';
import { useBlockDevToolGuard } from './useBlockDevToolGuard';

const originalWindowMetrics = {
  outerWidth: window.outerWidth,
  innerWidth: window.innerWidth,
  outerHeight: window.outerHeight,
  innerHeight: window.innerHeight,
};

function setWindowMetric(key: keyof typeof originalWindowMetrics, value: number) {
  Object.defineProperty(window, key, {
    configurable: true,
    value,
  });
}

function restoreWindowMetrics() {
  Object.entries(originalWindowMetrics).forEach(([key, value]) => {
    setWindowMetric(key as keyof typeof originalWindowMetrics, value);
  });
}

function GuardHarness({ enabled = true }: { enabled?: boolean }) {
  useBlockDevToolGuard({ enabled });
  const location = useLocation();

  useEffect(() => {
    document.body.dataset.path = location.pathname;
  }, [location.pathname]);

  return (
    <Routes>
      <Route path="/" element={<div>Dashboard route</div>} />
      <Route path="/blockdevtool" element={<div>Blocked route</div>} />
    </Routes>
  );
}

function GuardWithBlockPage() {
  useBlockDevToolGuard();
  const location = useLocation();

  useEffect(() => {
    document.body.dataset.path = `${location.pathname}${location.search}${location.hash}`;
  }, [location.hash, location.pathname, location.search]);

  return (
    <Routes>
      <Route path="/knowledge-bank" element={<div>Knowledge Bank route</div>} />
      <Route path="/blockdevtool" element={<BlockDevToolPage />} />
      <Route path="/" element={<div>Dashboard route</div>} />
    </Routes>
  );
}

describe('useBlockDevToolGuard', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    delete document.body.dataset.path;
  });

  afterEach(() => {
    restoreWindowMetrics();
  });

  it('navigates to blockdevtool when F12 is pressed', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <GuardHarness />
      </MemoryRouter>
    );

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F12', bubbles: true }));
    });

    expect(await screen.findByText('Blocked route')).toBeInTheDocument();
    await waitFor(() => expect(document.body.dataset.path).toBe('/blockdevtool'));
  });

  it('navigates to blockdevtool when an inspect shortcut is pressed', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <GuardHarness />
      </MemoryRouter>
    );

    const event = new KeyboardEvent('keydown', {
      key: 'I',
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      shiftKey: true,
    });
    let allowed = true;
    act(() => {
      allowed = window.dispatchEvent(event);
    });

    expect(allowed).toBe(false);
    expect(await screen.findByText('Blocked route')).toBeInTheDocument();
  });

  it('prevents the context menu and navigates to blockdevtool', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <GuardHarness />
      </MemoryRouter>
    );

    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    let allowed = true;
    act(() => {
      allowed = window.dispatchEvent(event);
    });

    expect(allowed).toBe(false);
    expect(await screen.findByText('Blocked route')).toBeInTheDocument();
  });

  it('does not navigate on browser resize or minimized-window size gaps', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <GuardHarness />
      </MemoryRouter>
    );

    setWindowMetric('outerWidth', 1200);
    setWindowMetric('innerWidth', 300);
    setWindowMetric('outerHeight', 900);
    setWindowMetric('innerHeight', 100);

    act(() => {
      window.dispatchEvent(new Event('resize'));
    });

    expect(screen.getByText('Dashboard route')).toBeInTheDocument();
    expect(document.body.dataset.path).toBe('/');
  });

  it('returns to the page that triggered blockdevtool after acknowledgement', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/knowledge-bank?tab=docs#unit-1']}>
        <GuardWithBlockPage />
      </MemoryRouter>
    );

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F12', bubbles: true }));
    });

    expect(await screen.findByRole('heading', { name: /DevTools/i })).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: /Tôi đã hiểu/i }));

    expect(await screen.findByText('Knowledge Bank route')).toBeInTheDocument();
    expect(document.body.dataset.path).toBe('/knowledge-bank?tab=docs#unit-1');
  });

  it('does nothing when disabled', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <GuardHarness enabled={false} />
      </MemoryRouter>
    );

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F12', bubbles: true }));
    });

    expect(screen.getByText('Dashboard route')).toBeInTheDocument();
  });

  it('ignores keydown-like events that do not carry a keyboard key', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <GuardHarness />
      </MemoryRouter>
    );

    expect(() => {
      act(() => {
        window.dispatchEvent(new Event('keydown', { bubbles: true }));
      });
    }).not.toThrow();

    expect(screen.getByText('Dashboard route')).toBeInTheDocument();
    expect(document.body.dataset.path).toBe('/');
  });

  it('lets callers handle a DevTools attempt without navigating', async () => {
    const onBlockedAttempt = vi.fn(() => true);

    function InterceptHarness() {
      useBlockDevToolGuard({ enabled: true, onBlockedAttempt });
      const location = useLocation();

      useEffect(() => {
        document.body.dataset.path = location.pathname;
      }, [location.pathname]);

      return (
        <Routes>
          <Route path="/" element={<div>Dashboard route</div>} />
          <Route path="/blockdevtool" element={<div>Blocked route</div>} />
        </Routes>
      );
    }

    render(
      <MemoryRouter initialEntries={['/']}>
        <InterceptHarness />
      </MemoryRouter>
    );

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F12', bubbles: true }));
    });

    expect(onBlockedAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ trigger: 'keyboard', key: 'F12' })
    );
    expect(screen.getByText('Dashboard route')).toBeInTheDocument();
    await waitFor(() => expect(document.body.dataset.path).toBe('/'));
  });

  it('navigates to blockdevtool when the caller declines a DevTools attempt', async () => {
    const onBlockedAttempt = vi.fn(() => false);

    function DeclineHarness() {
      useBlockDevToolGuard({ enabled: true, onBlockedAttempt });
      const location = useLocation();

      useEffect(() => {
        document.body.dataset.path = location.pathname;
      }, [location.pathname]);

      return (
        <Routes>
          <Route path="/" element={<div>Dashboard route</div>} />
          <Route path="/blockdevtool" element={<div>Blocked route</div>} />
        </Routes>
      );
    }

    render(
      <MemoryRouter initialEntries={['/']}>
        <DeclineHarness />
      </MemoryRouter>
    );

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F12', bubbles: true }));
    });

    expect(onBlockedAttempt).toHaveBeenCalled();
    expect(await screen.findByText('Blocked route')).toBeInTheDocument();
    await waitFor(() => expect(document.body.dataset.path).toBe('/blockdevtool'));
  });
});
