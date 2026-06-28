import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext } from '@tanstack/react-router';

import { DevelopmentTools } from '../app/DevelopmentTools';
import { AppShell } from '../shared/components/AppShell';

interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootRoute,
});

function RootRoute() {
  return (
    <>
      <AppShell />
      <DevelopmentTools />
    </>
  );
}
