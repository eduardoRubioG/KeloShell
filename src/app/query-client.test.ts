import { describe, expect, it } from 'vitest';

import { ApiError } from './api-error';
import { shouldRetry } from './query-client';

describe('query retry rule', () => {
  it('does not retry a 422', () => {
    expect(shouldRetry(0, new ApiError("Your coach's spreadsheet needs a fix.", 422))).toBe(false);
  });

  it('still retries a 502 up to the default of 3', () => {
    const error = new ApiError('bad gateway', 502);
    expect(shouldRetry(0, error)).toBe(true);
    expect(shouldRetry(2, error)).toBe(true);
    expect(shouldRetry(3, error)).toBe(false);
  });

  it('still retries a network error', () => {
    expect(shouldRetry(0, new TypeError('Failed to fetch'))).toBe(true);
  });
});
