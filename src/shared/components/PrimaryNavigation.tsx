import {
  Barbell,
  ClockCounterClockwise,
  PersonSimple,
} from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { Link, useRouterState } from '@tanstack/react-router';

interface NavigationItem {
  label: string;
  to: '/' | '/body' | '/history';
  icon: ReactNode;
}

const navigationItems: readonly NavigationItem[] = [
  {
    label: 'Train',
    to: '/',
    icon: <Barbell aria-hidden="true" size={20} weight="bold" />,
  },
  {
    label: 'Body',
    to: '/body',
    icon: <PersonSimple aria-hidden="true" size={20} weight="bold" />,
  },
  {
    label: 'History',
    to: '/history',
    icon: (
      <ClockCounterClockwise aria-hidden="true" size={20} weight="bold" />
    ),
  },
] as const;

export function PrimaryNavigation() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-10 mx-auto flex w-full max-w-app border-t border-border-subtle bg-nav/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl sm:border-x"
      aria-label="Primary navigation"
    >
      {navigationItems.map((item) => {
        const isActive = pathname === item.to;

        return (
          <Link
            key={item.to}
            to={item.to}
            className={`relative flex min-h-16 flex-1 flex-col items-center justify-center gap-1 transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-action ${
              isActive
                ? 'text-action'
                : 'text-text-faint hover:text-text-secondary'
            }`}
            aria-current={isActive ? 'page' : undefined}
          >
            {isActive ? (
              <span
                className="absolute top-0 h-0.5 w-8 rounded-full bg-action"
                aria-hidden="true"
              />
            ) : null}
            {item.icon}
            <span className="text-[0.625rem] font-semibold">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
