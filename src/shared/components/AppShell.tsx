import { Outlet } from '@tanstack/react-router';
import { useRouterState } from '@tanstack/react-router';

import { PrimaryNavigation } from './PrimaryNavigation';

export function AppShell() {
  const isLiftLogging = useRouterState({
    select: (state) =>
      typeof (state.location.search as { lift?: unknown }).lift === 'string',
  });

  return (
    <div className="min-h-dvh bg-canvas text-text-primary selection:bg-action selection:text-action-ink">
      <div className="relative mx-auto flex min-h-dvh w-full max-w-app flex-col overflow-hidden bg-canvas shadow-app sm:border-x sm:border-border-subtle">
        <main
          className={`flex-1 overflow-y-auto px-4 pt-[max(1.5rem,env(safe-area-inset-top))] ${
            isLiftLogging
              ? 'pb-[calc(6rem+env(safe-area-inset-bottom))]'
              : 'pb-[calc(6.5rem+env(safe-area-inset-bottom))]'
          }`}
        >
          <Outlet />
        </main>

        {isLiftLogging ? null : <PrimaryNavigation />}
      </div>
    </div>
  );
}
