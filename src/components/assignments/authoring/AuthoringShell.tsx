import React from 'react';

interface AuthoringShellProps {
  header: React.ReactNode;
  tabs: React.ReactNode;
  children: React.ReactNode;
}

export function AuthoringShell({ header, tabs, children }: AuthoringShellProps) {
  return (
    <main className="min-h-screen bg-[#f5f3ff] text-slate-950 dark:bg-slate-950 dark:text-slate-100">
      {header}
      {tabs}
      <div className="mx-auto max-w-7xl px-3 py-6 sm:px-5 lg:px-8">{children}</div>
    </main>
  );
}
