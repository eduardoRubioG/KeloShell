import { createFileRoute } from '@tanstack/react-router';

import { StepsPage } from '../features/steps/StepsPage';

export const Route = createFileRoute('/steps')({
  validateSearch: (search: Record<string, unknown>) => ({
    date:
      typeof search.date === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(search.date)
        ? search.date
        : undefined,
  }),
  component: StepsPage,
});
