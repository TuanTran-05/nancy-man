import React from 'react';
import { createRoot } from 'react-dom/client';

function BootstrapShell() {
  return React.createElement('main', { id: 'ops-console' }, 'Ops Console');
}

const root = document.getElementById('root');
if (!root) throw new Error('Ops Console root element is missing');
createRoot(root).render(React.createElement(BootstrapShell));
