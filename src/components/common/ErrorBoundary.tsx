import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertCircle, RefreshCcw } from 'lucide-react';
import { translations } from '../../lib/i18n/translations';
import type { Language } from '../../lib/i18n/localize';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);

    // Log crash to backend telemetry to prevent swallowing in production (Finding #3)
    try {
      import('../../lib/audit/auditLog')
        .then(({ logAuditActivity }) => {
          logAuditActivity('update', 'system_crash', error.name || 'Error', undefined, {
            message: error.message || 'No message',
            stack: error.stack || '',
            componentStack: errorInfo.componentStack || '',
            url: typeof window !== 'undefined' ? window.location.href : '',
          });
        })
        .catch((err) => {
          console.error('[ErrorBoundary] Failed to import logAuditActivity:', err);
        });
    } catch (err) {
      console.error('[ErrorBoundary] Failed to dispatch crash telemetry:', err);
    }
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  private get t() {
    const lang = (localStorage.getItem('language') as Language) || 'vi';
    return translations[lang].errorBoundary;
  }

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-[400px] flex items-center justify-center p-6">
          <div className="bg-surface p-8 rounded-3xl shadow-sm border border-border-default max-w-md w-full text-center">
            <div className="w-16 h-16 bg-red-50 dark:bg-red-500/10 rounded-2xl flex items-center justify-center text-red-500 mx-auto mb-6">
              <AlertCircle className="w-8 h-8" />
            </div>
            <h2 className="text-xl font-bold text-heading mb-2">{this.t.title}</h2>
            <p className="text-muted mb-8 text-sm">{this.t.description}</p>
            <button
              onClick={this.handleReset}
              className="w-full flex items-center justify-center space-x-2 bg-blue-600 text-white px-6 py-3 rounded-xl hover:bg-blue-700 transition-all font-medium shadow-lg shadow-blue-100 dark:shadow-none"
            >
              <RefreshCcw className="w-4 h-4" />
              <span>{this.t.reload}</span>
            </button>
            {typeof window !== 'undefined' && window.location.hostname === 'localhost' && (
              <div className="mt-6 p-4 bg-surface-alt rounded-xl text-left overflow-auto max-h-40">
                <p className="text-xs font-mono text-red-600 dark:text-red-400 whitespace-pre-wrap">
                  {this.state.error?.toString()}
                </p>
              </div>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
