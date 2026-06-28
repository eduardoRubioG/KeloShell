import { createFileRoute } from '@tanstack/react-router';

import { BodyPage } from '../features/body/BodyPage';

export const Route = createFileRoute('/body')({
  component: BodyPage,
});
