// @vitest-environment jsdom
import { fireEvent, render, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TurnstileWidget, type TurnstileWidgetHandle } from './TurnstileWidget';

describe('TurnstileWidget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (window as any).turnstile = {
      render: vi.fn((_container: HTMLElement, options: Record<string, unknown>) => {
        (options.callback as (token: string) => void)('widget-token');
        return 'widget-id';
      }),
      reset: vi.fn(),
      remove: vi.fn(),
    };
  });

  afterEach(() => {
    delete (window as any).turnstile;
    document.querySelectorAll('script[data-turnstile-script]').forEach((script) => script.remove());
  });

  it('renders explicitly and emits a token', async () => {
    const onVerify = vi.fn();

    render(<TurnstileWidget siteKey="site-key" action="login" onVerify={onVerify} />);

    await waitFor(() => {
      expect(window.turnstile!.render).toHaveBeenCalledWith(
        expect.any(HTMLElement),
        expect.objectContaining({
          sitekey: 'site-key',
          action: 'login',
          theme: 'auto',
        })
      );
    });
    expect(onVerify).toHaveBeenCalledWith('widget-token');
  });

  it('resets the rendered widget through the imperative handle', async () => {
    const ref = createRef<TurnstileWidgetHandle>();

    render(<TurnstileWidget ref={ref} siteKey="site-key" action="login" onVerify={vi.fn()} />);

    await waitFor(() => expect(ref.current).not.toBeNull());
    ref.current!.reset();

    expect(window.turnstile!.reset).toHaveBeenCalledWith('widget-id');
  });

  it('retries loading the CDN script after an initial script failure', async () => {
    delete (window as any).turnstile;
    const onError = vi.fn();

    const first = render(
      <TurnstileWidget siteKey="site-key" action="login" onVerify={vi.fn()} onError={onError} />
    );

    const firstScript = document.querySelector<HTMLScriptElement>('script[data-turnstile-script]');
    expect(firstScript).not.toBeNull();
    fireEvent.error(firstScript!);

    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(document.querySelector('script[data-turnstile-script]')).toBeNull();

    first.unmount();
    render(<TurnstileWidget siteKey="site-key" action="login" onVerify={vi.fn()} />);

    const secondScript = document.querySelector<HTMLScriptElement>('script[data-turnstile-script]');
    expect(secondScript).not.toBeNull();
    expect(secondScript).not.toBe(firstScript);
  });
});
