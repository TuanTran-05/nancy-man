import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

type TurnstileWidgetId = string;

type TurnstileRenderOptions = {
  sitekey: string;
  action?: string;
  theme?: 'auto' | 'light' | 'dark';
  callback?: (token: string) => void;
  'expired-callback'?: () => void;
  'error-callback'?: () => void;
  'unsupported-callback'?: () => void;
};

type TurnstileApi = {
  render: (container: HTMLElement, options: TurnstileRenderOptions) => TurnstileWidgetId;
  reset: (widgetId: TurnstileWidgetId) => void;
  remove: (widgetId: TurnstileWidgetId) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export type TurnstileWidgetHandle = {
  reset: () => void;
};

type TurnstileWidgetProps = {
  siteKey: string;
  action: string;
  onVerify: (token: string) => void;
  onExpire?: () => void;
  onError?: () => void;
};

let scriptPromise: Promise<void> | null = null;

function loadTurnstileScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise((resolve, reject) => {
    const rejectScriptLoad = (script: HTMLScriptElement) => {
      script.remove();
      scriptPromise = null;
      reject(new Error('Turnstile script failed'));
    };

    const existing = document.querySelector<HTMLScriptElement>('script[data-turnstile-script]');
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => rejectScriptLoad(existing), {
        once: true,
      });
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.defer = true;
    script.async = true;
    script.dataset.turnstileScript = 'true';
    script.onload = () => resolve();
    script.onerror = () => rejectScriptLoad(script);
    document.head.appendChild(script);
  });

  scriptPromise.catch(() => {
    scriptPromise = null;
  });
  return scriptPromise;
}

export const TurnstileWidget = forwardRef<TurnstileWidgetHandle, TurnstileWidgetProps>(
  ({ siteKey, action, onVerify, onExpire, onError }, ref) => {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const widgetIdRef = useRef<TurnstileWidgetId | null>(null);
    const onVerifyRef = useRef(onVerify);
    const onExpireRef = useRef(onExpire);
    const onErrorRef = useRef(onError);

    useEffect(() => {
      onVerifyRef.current = onVerify;
      onExpireRef.current = onExpire;
      onErrorRef.current = onError;
    }, [onError, onExpire, onVerify]);

    useImperativeHandle(ref, () => ({
      reset() {
        onVerifyRef.current('');
        if (widgetIdRef.current && window.turnstile) {
          window.turnstile.reset(widgetIdRef.current);
        }
      },
    }));

    useEffect(() => {
      let cancelled = false;

      async function renderWidget() {
        if (!siteKey || !containerRef.current) {
          onErrorRef.current?.();
          return;
        }

        try {
          await loadTurnstileScript();
          if (cancelled || !window.turnstile || !containerRef.current) return;

          widgetIdRef.current = window.turnstile.render(containerRef.current, {
            sitekey: siteKey,
            action,
            theme: 'auto',
            callback: (token) => onVerifyRef.current(token),
            'expired-callback': () => {
              onVerifyRef.current('');
              onExpireRef.current?.();
            },
            'error-callback': () => {
              onVerifyRef.current('');
              onErrorRef.current?.();
            },
            'unsupported-callback': () => {
              onVerifyRef.current('');
              onErrorRef.current?.();
            },
          });
        } catch {
          onVerifyRef.current('');
          onErrorRef.current?.();
        }
      }

      renderWidget();

      return () => {
        cancelled = true;
        if (widgetIdRef.current && window.turnstile) {
          window.turnstile.remove(widgetIdRef.current);
          widgetIdRef.current = null;
        }
      };
    }, [action, siteKey]);

    return <div ref={containerRef} className="min-h-[65px] w-full" />;
  }
);

TurnstileWidget.displayName = 'TurnstileWidget';
