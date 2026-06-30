import { createFileRoute } from '@tanstack/react-router';

import { BodyPage } from '../features/body/BodyPage';

export const Route = createFileRoute('/body')({
  validateSearch: (search: Record<string, unknown>) => ({
    date:
      typeof search.date === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(search.date)
        ? search.date
        : undefined,
  }),
  component: BodyPage,
});
