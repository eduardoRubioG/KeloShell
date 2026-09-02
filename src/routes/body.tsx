import { createFileRoute } from '@tanstack/react-router';

import { BodyPage } from '../features/body/BodyPage';

const segments = ['weight', 'check-ins'] as const;

export const Route = createFileRoute('/body')({
  validateSearch: (search: Record<string, unknown>) => ({
    date:
      typeof search.date === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(search.date)
        ? search.date
        : undefined,
    checkInDate:
      typeof search.checkInDate === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(search.checkInDate)
        ? search.checkInDate
        : undefined,
    segment:
      typeof search.segment === 'string' &&
      segments.includes(search.segment as (typeof segments)[number])
        ? (search.segment as (typeof segments)[number])
        : undefined,
  }),
  component: BodyPage,
});
