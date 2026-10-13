import { apiErrorFrom } from '../../../app/api-error';
import type {
  BodyweightResponse,
  DailyBodyweightRequest,
} from '../../../contracts/body';

export async function fetchBodyweight(): Promise<BodyweightResponse> {
  const response = await fetch('/api/bodyweight', {
    headers: { accept: 'application/json' },
  });
  if (!response.ok) {
    throw await apiErrorFrom(response, 'Bodyweight data could not be loaded.');
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
    throw await apiErrorFrom(response, 'The bodyweight could not be synced.');
  }
  return (await response.json()) as BodyweightResponse;
}
