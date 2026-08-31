import { useEffect, useState } from 'react';

export type OpsRoute = '/' | '/variables' | '/users' | '/bootstrap/mfa';

function normalizePath(pathname: string): OpsRoute {
  if (pathname === '/variables' || pathname === '/users' || pathname === '/bootstrap/mfa') {
    return pathname;
  }
  return '/';
}

export function readRoute(): OpsRoute {
  return normalizePath(window.location.pathname);
}

export function navigate(route: OpsRoute): void {
  if (window.location.pathname === route) return;
  window.history.pushState({}, '', route);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function useOpsRoute(): OpsRoute {
  const [route, setRoute] = useState<OpsRoute>(() => readRoute());
  useEffect(() => {
    const onPopState = () => setRoute(readRoute());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
  return route;
}
