// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LuckyLens from './LuckyLens';

vi.mock('../../lib/i18n/useLanguage', () => ({
  useLanguage: () => ({
    t: {
      luckyLensPage: {
        subtitle: 'Call students',
        faceDetectionError: 'Face detection unavailable',
        loadingAI: 'Loading AI',
        ready: 'Ready',
        startCall: 'Start',
        tutorialTitle: 'How it works',
        step1Title: 'Step 1',
        step1Desc: 'Stand in frame',
        step2Title: 'Step 2',
        step2Desc: 'Scan faces',
        step3Title: 'Step 3',
        step3Desc: 'Pick one',
        readyToScan: 'Ready to scan',
        noStudentsFound: 'No students found',
        scanning: 'Scanning',
        faces: 'faces',
        scanFailed: 'Scan failed',
        retry: 'Retry',
        selectedStudent: 'Selected student',
        pickAnother: 'Pick another',
        rescan: 'Rescan',
        close: 'Close',
      },
    },
  }),
}));

vi.mock('react-webcam', () => ({
  default: React.forwardRef<HTMLVideoElement>((props, ref) => (
    <video ref={ref} data-testid="webcam" {...props} />
  )),
}));

vi.mock('framer-motion', async () => {
  const ReactModule = await import('react');
  return {
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    motion: {
      div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
        <div {...props}>{children}</div>
      ),
    },
  };
});

vi.mock('@mediapipe/tasks-vision', () => ({
  FilesetResolver: {
    forVisionTasks: vi.fn().mockResolvedValue({}),
  },
  FaceDetector: {
    createFromOptions: vi.fn().mockResolvedValue({
      detectForVideo: vi.fn(() => ({ detections: [] })),
      close: vi.fn(),
    }),
  },
}));

describe('LuckyLens cleanup', () => {
  beforeEach(() => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(Date.now()), 16)
    );
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id: number) => {
      window.clearTimeout(id);
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('cancels scanning work when the component unmounts', async () => {
    vi.useRealTimers();
    const clearIntervalSpy = vi.spyOn(window, 'clearInterval');
    const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout');
    const cancelFrameSpy = vi.spyOn(window, 'cancelAnimationFrame');

    const view = render(<LuckyLens />);
    await screen.findByText('Ready');

    vi.useFakeTimers();
    fireEvent.click(screen.getByText(/Start/));
    fireEvent.click(screen.getByText('Ready to scan'));
    vi.advanceTimersByTime(50);

    view.unmount();

    expect(cancelFrameSpy).toHaveBeenCalled();
    expect(clearIntervalSpy).toHaveBeenCalled();
    expect(clearTimeoutSpy).toHaveBeenCalled();
  });
});
