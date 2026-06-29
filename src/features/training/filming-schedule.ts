export function isLiftScheduledForFilming(
  weekNumber: number,
  liftIndex: number
): boolean {
  if (
    !Number.isInteger(weekNumber) ||
    weekNumber < 1 ||
    !Number.isInteger(liftIndex) ||
    liftIndex < 0
  ) {
    return false;
  }

  const filmingWeekIndex = (weekNumber - 1) % 3;

  if (filmingWeekIndex === 0) {
    return liftIndex < 2;
  }

  if (filmingWeekIndex === 1) {
    return liftIndex >= 2 && liftIndex < 4;
  }

  return liftIndex >= 4;
}
