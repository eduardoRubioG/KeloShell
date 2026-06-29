import { createFileRoute } from '@tanstack/react-router';

import { TrainingPage } from '../features/training/TrainingPage';

export const Route = createFileRoute('/')({
  validateSearch: (search: Record<string, unknown>) => ({
    week:
      typeof search.week === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(search.week)
        ? search.week
        : undefined,
    session:
      search.session === 'Upper A' ||
      search.session === 'Lower A' ||
      search.session === 'Upper B' ||
      search.session === 'Lower B'
        ? search.session
        : undefined,
    lift:
      typeof search.lift === 'string' &&
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(search.lift) &&
      search.lift.length <= 120
        ? search.lift
        : undefined,
  }),
  component: TrainingPage,
});
