import type {
  MeasurementCheckInEntry,
  MeasurementField,
  MeasurementCheckInStatus,
} from '../../contracts/measurements';

export function checkInStatus(checkIn: MeasurementCheckInEntry): MeasurementCheckInStatus {
  return checkIn.status;
}

export function filledFieldCount(
  checkIn: MeasurementCheckInEntry,
  fields: readonly MeasurementField[]
): number {
  return fields.filter((field) => checkIn.values[field.id] !== null).length;
}

export function dueTodayCheckIn(
  checkIns: readonly MeasurementCheckInEntry[],
  today: string
): MeasurementCheckInEntry | null {
  return checkIns.find((checkIn) => checkIn.date === today) ?? null;
}

export function pastCheckIns(
  checkIns: readonly MeasurementCheckInEntry[],
  today: string
): MeasurementCheckInEntry[] {
  return checkIns.filter((checkIn) => checkIn.date !== today);
}

export function previousFieldValue(
  checkIns: readonly MeasurementCheckInEntry[],
  selectedDate: string,
  fieldId: string
): { date: string; value: string } | null {
  const sorted = [...checkIns].sort((left, right) => right.date.localeCompare(left.date));
  for (const checkIn of sorted) {
    if (checkIn.date >= selectedDate) {
      continue;
    }
    const value = checkIn.values[fieldId];
    if (value !== null) {
      return { date: checkIn.date, value };
    }
  }

  for (const checkIn of sorted) {
    if (checkIn.date === selectedDate) {
      continue;
    }
    const value = checkIn.values[fieldId];
    if (value !== null) {
      return { date: checkIn.date, value };
    }
  }

  return null;
}
