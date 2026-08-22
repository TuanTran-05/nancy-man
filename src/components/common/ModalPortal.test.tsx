// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ModalPortal } from './ModalPortal';

describe('ModalPortal', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'scrollTo', { value: vi.fn(), writable: true });
    document.body.style.cssText = '';
    document.documentElement.style.cssText = '';
  });

  it('can lock and restore page scrolling through the shared portal helper', () => {
    const { unmount } = render(
      <ModalPortal lockScroll>
        <div>Shared modal body</div>
      </ModalPortal>
    );

    expect(screen.getByText('Shared modal body')).toBeInTheDocument();
    expect(document.documentElement.style.overflow).toBe('hidden');
    expect(document.body.style.overflow).toBe('hidden');
    expect(document.body.style.position).toBe('fixed');

    unmount();

    expect(document.documentElement.style.overflow).toBe('');
    expect(document.body.style.overflow).toBe('');
    expect(document.body.style.position).toBe('');
  });
});
