import { Outlet } from '@tanstack/react-router';

import { PrimaryNavigation } from './PrimaryNavigation';

export function AppShell() {
  return (
    <div className="min-h-dvh bg-canvas text-text-primary selection:bg-action selection:text-action-ink">
      <div className="relative mx-auto flex min-h-dvh w-full max-w-app flex-col overflow-hidden bg-canvas shadow-app sm:border-x sm:border-border-subtle">
        <main className="flex-1 overflow-y-auto px-4 pb-[calc(6.5rem+env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))]">
          <Outlet />
        </main>

        <PrimaryNavigation />
      </div>
    </div>
  );
}
