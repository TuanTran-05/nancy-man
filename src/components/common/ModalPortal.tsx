import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';

const FOCUSABLE_SELECTORS = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

interface ModalPortalProps {
  children: React.ReactNode;
  /** When true, traps focus inside the modal and restores focus on unmount. */
  trapFocus?: boolean;
  /** When true, locks page scrolling while the portal is mounted. */
  lockScroll?: boolean;
}

export function ModalPortal({ children, trapFocus = false, lockScroll = false }: ModalPortalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  useBodyScrollLock(lockScroll);

  useEffect(() => {
    if (!trapFocus) return;

    previousFocusRef.current = document.activeElement as HTMLElement;

    const container = containerRef.current;
    if (!container) return;

    // Small delay to let the modal render its content
    const timer = setTimeout(() => {
      const focusable = Array.from(
        container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS)
      ).filter((el) => !el.closest('[aria-hidden="true"]'));

      if (focusable.length > 0) {
        focusable[0].focus();
      }
    }, 50);

    const getFocusableElements = () =>
      Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS)).filter(
        (el) => !el.closest('[aria-hidden="true"]')
      );

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;

      const currentFocusable = getFocusableElements();
      if (currentFocusable.length === 0) return;

      const first = currentFocusable[0];
      const last = currentFocusable[currentFocusable.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    container.addEventListener('keydown', handleKeyDown);

    return () => {
      clearTimeout(timer);
      container.removeEventListener('keydown', handleKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [trapFocus]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    trapFocus ? <div ref={containerRef}>{children}</div> : children,
    document.body
  );
}
