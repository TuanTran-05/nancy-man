// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRef } from 'react';
import { useExamAntiCheat } from './useExamAntiCheat';

describe('useExamAntiCheat', () => {
  function setupHook(isActive = true) {
    const suspendRef = { current: false };
    const { result, unmount } = renderHook(
      ({ isActive, suspendRef }) => useExamAntiCheat(isActive, suspendRef),
      { initialProps: { isActive, suspendRef } }
    );
    return { result, unmount, suspendRef };
  }

  it('initial state has zero counts when active', () => {
    const { result } = setupHook(true);
    expect(result.current.metrics.tabSwitchCount).toBe(0);
    expect(result.current.metrics.focusLossCount).toBe(0);
    expect(result.current.metrics.fullscreenExitCount).toBe(0);
    expect(result.current.metrics.sessionStartedAt).not.toBeNull();
  });

  it('tab switch increments on visibilitychange hidden', () => {
    const { result } = setupHook(true);

    act(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(result.current.metrics.tabSwitchCount).toBe(1);

    // Reset visibilityState
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  });

  it('focus loss increments on window blur', () => {
    const { result } = setupHook(true);

    act(() => {
      window.dispatchEvent(new Event('blur'));
    });

    expect(result.current.metrics.focusLossCount).toBe(1);
  });

  it('fullscreen exit increments when fullscreenElement is null', () => {
    const { result } = setupHook(true);

    act(() => {
      Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true });
      document.dispatchEvent(new Event('fullscreenchange'));
    });

    expect(result.current.metrics.fullscreenExitCount).toBe(1);
  });

  it('suspendRef prevents counting', () => {
    const { result, suspendRef } = setupHook(true);
    suspendRef.current = true;

    act(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('blur'));
    });

    expect(result.current.metrics.tabSwitchCount).toBe(0);
    expect(result.current.metrics.focusLossCount).toBe(0);

    // Reset
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  });

  it('resets when isActive changes to true', () => {
    const suspendRef = { current: false };
    const { result, rerender } = renderHook(
      ({ isActive, suspendRef }) => useExamAntiCheat(isActive, suspendRef),
      { initialProps: { isActive: false, suspendRef } }
    );

    // Not active initially - counts should be 0 and sessionStartedAt null
    expect(result.current.metrics.tabSwitchCount).toBe(0);
    expect(result.current.metrics.sessionStartedAt).toBeNull();

    // Activate
    rerender({ isActive: true, suspendRef });

    expect(result.current.metrics.tabSwitchCount).toBe(0);
    expect(result.current.metrics.sessionStartedAt).not.toBeNull();
  });

  it('enterFullscreen calls requestFullscreen', async () => {
    const mockRequestFullscreen = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      value: mockRequestFullscreen,
      configurable: true,
    });

    const { result } = setupHook(true);

    await act(async () => {
      const success = await result.current.enterFullscreen();
      expect(success).toBe(true);
    });

    expect(mockRequestFullscreen).toHaveBeenCalled();

    // Cleanup
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      value: undefined,
      configurable: true,
    });
  });

  it('exitFullscreenSafe calls exitFullscreen', async () => {
    const mockExitFullscreen = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(document, 'fullscreenElement', { value: {}, configurable: true });
    Object.defineProperty(document, 'exitFullscreen', {
      value: mockExitFullscreen,
      configurable: true,
    });

    const { result } = setupHook(true);

    await act(async () => {
      await result.current.exitFullscreenSafe();
    });

    expect(mockExitFullscreen).toHaveBeenCalled();

    // Cleanup
    Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true });
    Object.defineProperty(document, 'exitFullscreen', {
      value: undefined,
      configurable: true,
    });
  });

  it('getIntegrityForSubmit returns snapshot', () => {
    const { result } = setupHook(true);

    // Trigger some events
    act(() => {
      window.dispatchEvent(new Event('blur'));
      window.dispatchEvent(new Event('blur'));
    });

    const snapshot = result.current.getIntegrityForSubmit();
    expect(snapshot.focusLossCount).toBe(2);
    expect(snapshot.tabSwitchCount).toBe(0);
    expect(snapshot.fullscreenExitCount).toBe(0);
    expect(typeof snapshot.sessionStartedAt).toBe('string');
  });

  it('cleans up listeners on unmount', () => {
    const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener');
    const windowRemoveSpy = vi.spyOn(window, 'removeEventListener');

    const { unmount } = setupHook(true);
    unmount();

    expect(removeEventListenerSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    expect(windowRemoveSpy).toHaveBeenCalledWith('blur', expect.any(Function));
    expect(removeEventListenerSpy).toHaveBeenCalledWith('fullscreenchange', expect.any(Function));

    removeEventListenerSpy.mockRestore();
    windowRemoveSpy.mockRestore();
  });

  it('records a manual focus loss for strict devtools attempts', () => {
    const { result } = setupHook(true);

    act(() => {
      result.current.recordFocusLoss();
    });

    expect(result.current.metrics.focusLossCount).toBe(1);
    expect(result.current.metrics.tabSwitchCount).toBe(0);
    expect(result.current.metrics.fullscreenExitCount).toBe(0);
  });
});
