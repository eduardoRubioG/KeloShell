import { apiErrorFrom } from '../../../app/api-error';
import type { StepsResponse, DailyStepsRequest } from '../../../contracts/steps';

export async function fetchSteps(today: string): Promise<StepsResponse> {
  const response = await fetch(`/api/steps?today=${encodeURIComponent(today)}`, {
    headers: { accept: 'application/json' },
  });
  if (!response.ok) {
    throw await apiErrorFrom(response, 'Steps data could not be loaded.');
  }
  return (await response.json()) as StepsResponse;
}

export async function saveDailySteps(
  request: DailyStepsRequest & { today: string }
): Promise<StepsResponse> {
  const { today, ...body } = request;
  const response = await fetch(`/api/daily-steps?today=${encodeURIComponent(today)}`, {
    method: 'PUT',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw await apiErrorFrom(response, 'The steps could not be synced.');
  }
  return (await response.json()) as StepsResponse;
}
