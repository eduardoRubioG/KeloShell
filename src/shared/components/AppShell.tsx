import { Outlet } from '@tanstack/react-router';
import { useRouterState } from '@tanstack/react-router';

import { PrimaryNavigation } from './PrimaryNavigation';

export function AppShell() {
  const isFocusedFlow = useRouterState({
    select: (state) => {
      const search = state.location.search as { date?: unknown; lift?: unknown };
      return (
        typeof search.lift === 'string' ||
        (state.location.pathname === '/body' && typeof search.date === 'string')
      );
    },
  });

  return (
    <div className="h-full overflow-hidden bg-canvas text-text-primary selection:bg-action selection:text-action-ink">
      <div className="relative mx-auto flex h-full min-h-0 w-full max-w-app flex-col overflow-hidden bg-canvas shadow-app sm:border-x sm:border-border-subtle">
        <main
          className={`min-h-0 flex-1 overflow-y-auto px-4 pt-[max(2rem,calc(env(safe-area-inset-top)+1rem))] ${
            isFocusedFlow
              ? 'pb-[calc(7rem+env(safe-area-inset-bottom))]'
              : 'pb-4'
          }`}
        >
          <Outlet />
        </main>

        {isFocusedFlow ? null : <PrimaryNavigation />}
      </div>
    </div>
  );
}
