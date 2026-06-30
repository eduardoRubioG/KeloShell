import type { ApiErrorResponse } from '../../../contracts/training';
import type {
  BodyweightResponse,
  DailyBodyweightRequest,
} from '../../../contracts/body';

export async function fetchBodyweight(): Promise<BodyweightResponse> {
  const response = await fetch('/api/bodyweight', {
    headers: { accept: 'application/json' },
  });
  if (!response.ok) {
    const payload = (await response
      .json()
      .catch(() => null)) as ApiErrorResponse | null;
    throw new Error(payload?.error ?? 'Bodyweight data could not be loaded.');
  }
  return (await response.json()) as BodyweightResponse;
}

export async function saveDailyBodyweight(
  request: DailyBodyweightRequest
): Promise<BodyweightResponse> {
  const response = await fetch('/api/daily-bodyweight', {
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
    throw new Error(payload?.error ?? 'The bodyweight could not be synced.');
  }
  return (await response.json()) as BodyweightResponse;
}
