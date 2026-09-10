import { Component, type ErrorInfo, type ReactNode } from 'react';

import { captureBrowserException } from '../telemetry/runtimeTelemetry.js';

export class OpsErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: true } {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    captureBrowserException(error, {
      code: 'OPS_WEB_REACT_RENDER_FAILED',
      source: 'browser',
      ...(info.componentStack ? { componentStack: info.componentStack } : {})
    });
  }

  render(): ReactNode {
    if (this.state.failed) {
      return (
        <main role="alert" className="loading-shell">
          Không thể hiển thị bảng điều khiển.
        </main>
      );
    }
    return this.props.children;
  }
}
