import { createFileRoute } from '@tanstack/react-router';

import { TrainingPage } from '../features/training/TrainingPage';

export const Route = createFileRoute('/')({
  validateSearch: (search: Record<string, unknown>) => ({
    week:
      typeof search.week === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(search.week)
        ? search.week
        : undefined,
  }),
  component: TrainingPage,
});
