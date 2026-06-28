import { lazy, Suspense } from 'react';

const RouterDevtools = import.meta.env.DEV
  ? lazy(() =>
      import('@tanstack/react-router-devtools').then((module) => ({
        default: module.TanStackRouterDevtools,
      }))
    )
  : null;

const QueryDevtools = import.meta.env.DEV
  ? lazy(() =>
      import('@tanstack/react-query-devtools').then((module) => ({
        default: module.ReactQueryDevtools,
      }))
    )
  : null;

export function DevelopmentTools() {
  if (!RouterDevtools || !QueryDevtools) {
    return null;
  }

  return (
    <Suspense fallback={null}>
      <RouterDevtools />
      <QueryDevtools initialIsOpen={false} />
    </Suspense>
  );
}
