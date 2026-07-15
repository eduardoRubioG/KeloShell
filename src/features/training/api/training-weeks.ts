import type {
  ApiErrorResponse,
  LiftLogRequest,
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

export async function saveLiftLog(
  request: LiftLogRequest
): Promise<TrainingWeeksResponse> {
  const response = await fetch('/api/lift-log', {
    method: 'PUT',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    const payload = (await response
      .json()
      .catch(() => null)) as ApiErrorResponse | null;
    throw new Error(payload?.error ?? 'The Lift Log could not be synced.');
  }
  return (await response.json()) as TrainingWeeksResponse;
}
