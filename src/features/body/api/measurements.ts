import type { ApiErrorResponse } from '../../../contracts/training';
import type {
  MeasurementCheckInSaveRequest,
  MeasurementsResponse,
} from '../../../contracts/measurements';

export async function fetchMeasurements(): Promise<MeasurementsResponse> {
  const response = await fetch('/api/measurements', {
    headers: { accept: 'application/json' },
  });
  if (!response.ok) {
    const payload = (await response
      .json()
      .catch(() => null)) as ApiErrorResponse | null;
    throw new Error(payload?.error ?? 'Measurement data could not be loaded.');
  }
  return (await response.json()) as MeasurementsResponse;
}

export async function saveMeasurementCheckIn(
  request: MeasurementCheckInSaveRequest
): Promise<MeasurementsResponse> {
  const response = await fetch('/api/measurement-check-in', {
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
    throw new Error(payload?.error ?? 'The measurement check-in could not be synced.');
  }
  return (await response.json()) as MeasurementsResponse;
}
