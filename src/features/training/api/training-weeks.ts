import type {
  ApiErrorResponse,
  TrainingWeeksResponse,
} from '../../../contracts/training';

export async function fetchTrainingWeeks(): Promise<TrainingWeeksResponse> {
  const response = await fetch('/api/training-weeks', {
    headers: { accept: 'application/json' },
  });
  if (!response.ok) {
    const payload = (await response
      .json()
      .catch(() => null)) as ApiErrorResponse | null;
    throw new Error(payload?.error ?? 'Training Weeks could not be loaded.');
  }
  return (await response.json()) as TrainingWeeksResponse;
}
