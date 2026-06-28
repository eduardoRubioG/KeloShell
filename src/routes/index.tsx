import { createFileRoute } from '@tanstack/react-router';

import { TrainingPage } from '../features/training/TrainingPage';

export const Route = createFileRoute('/')({
  component: TrainingPage,
});
