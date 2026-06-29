import { describe, expect, it } from 'vitest';

import { isLiftScheduledForFilming } from './filming-schedule';

describe('isLiftScheduledForFilming', () => {
  it.each([1, 4])(
    'schedules the first and second lifts in Training Week %i',
    (weekNumber) => {
      expect(scheduledLiftNumbers(weekNumber, 7)).toEqual([1, 2]);
    }
  );

  it.each([2, 5])(
    'schedules the third and fourth lifts in Training Week %i',
    (weekNumber) => {
      expect(scheduledLiftNumbers(weekNumber, 7)).toEqual([3, 4]);
    }
  );

  it.each([3, 6])(
    'schedules the fifth and all remaining lifts in Training Week %i',
    (weekNumber) => {
      expect(scheduledLiftNumbers(weekNumber, 7)).toEqual([5, 6, 7]);
    }
  );

  it('does not schedule a lift in a short third-week Workout Session', () => {
    expect(scheduledLiftNumbers(3, 4)).toEqual([]);
  });

  it('rejects invalid Training Week numbers and lift indexes', () => {
    expect(isLiftScheduledForFilming(0, 0)).toBe(false);
    expect(isLiftScheduledForFilming(1.5, 0)).toBe(false);
    expect(isLiftScheduledForFilming(1, -1)).toBe(false);
    expect(isLiftScheduledForFilming(1, 0.5)).toBe(false);
  });
});

function scheduledLiftNumbers(
  weekNumber: number,
  liftCount: number
): number[] {
  return Array.from({ length: liftCount }, (_, index) => index)
    .filter((index) => isLiftScheduledForFilming(weekNumber, index))
    .map((index) => index + 1);
}
