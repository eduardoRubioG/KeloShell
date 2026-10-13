import { QueryClient } from '@tanstack/react-query';

import { ApiError } from './api-error';

const DEFAULT_RETRIES = 3;

/**
 * A 422 means the Source Spreadsheet has a format problem. That is deterministic,
 * so retrying never helps; every other failure keeps React Query's default of 3 retries.
 */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status === 422) return false;
  return failureCount < DEFAULT_RETRIES;
}

export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: shouldRetry } },
});
