import type { ApiErrorResponse } from '../../../contracts/training';
import type { StreaksResponse, CreatineLogRequest } from '../../../contracts/streaks';

export async function fetchStreaks(today: string): Promise<StreaksResponse> {
  const response = await fetch(`/api/streaks?today=${encodeURIComponent(today)}`, {
    headers: { accept: 'application/json' },
  });
  if (!response.ok) {
    const payload = (await response
      .json()
      .catch(() => null)) as ApiErrorResponse | null;
    throw new Error(payload?.error ?? 'Streaks could not be loaded.');
  }
  return (await response.json()) as StreaksResponse;
}

export async function logCreatineHabit(
  request: CreatineLogRequest
): Promise<StreaksResponse> {
  const response = await fetch('/api/creatine-log', {
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
    throw new Error(payload?.error ?? 'The creatine log could not be synced.');
  }
  return (await response.json()) as StreaksResponse;
}
