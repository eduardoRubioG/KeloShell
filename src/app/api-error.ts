import type { ApiErrorResponse } from '../contracts/training';

/** An API failure that keeps the HTTP status so callers can tell a 422 from a 502. */
export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** Builds the error for a non-ok response: the API's own message, else the fallback. */
export async function apiErrorFrom(response: Response, fallback: string): Promise<ApiError> {
  const payload = (await response.json().catch(() => null)) as ApiErrorResponse | null;
  return new ApiError(payload?.error ?? fallback, response.status);
}
