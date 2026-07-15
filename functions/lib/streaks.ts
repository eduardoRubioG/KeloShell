import type { StreakSummary, StreaksResponse, CreatineLogRequest } from '../../src/contracts/streaks';
import type { TrainingWeeksResponse } from '../../src/contracts/training';
import { HABITS_SHEET_NAME, CREATINE_HABIT_KEY } from './config';
import { readBodyweight, type BodyTrackingGateway } from './body-tracking';
import { readTrainingWeeks, type TrainingWeeksGateway } from './training-weeks';

const SHEETS_EPOCH_UTC = Date.UTC(1899, 11, 30);

export interface HabitsGateway {
  readRanges(
    ranges: readonly string[],
    valueRenderOption: 'FORMATTED_VALUE' | 'UNFORMATTED_VALUE'
  ): Promise<unknown[][][]>;
  writeRange(sheetName: string, range: string, values: readonly unknown[]): Promise<void>;
  clearRange(sheetName: string, range: string): Promise<void>;
}

export function consecutiveStreak(
  dates: Set<string>,
  today: string
): { count: number; todayComplete: boolean } {
  const todayComplete = dates.has(today);
  let current = todayComplete ? today : addDays(today, -1);
  if (!dates.has(current)) {
    return { count: 0, todayComplete };
  }
  let count = 0;
  while (dates.has(current)) {
    count += 1;
    current = addDays(current, -1);
  }
  return { count, todayComplete };
}

export function computeWorkoutStreakFromWeeks(
  trainingResponse: TrainingWeeksResponse,
  today: string
): { count: number; todayComplete: boolean } {
  const availableWeeks = trainingResponse.weeks.filter(
    (w) => w.availability === 'available'
  );
  if (availableWeeks.length === 0) {
    return { count: 0, todayComplete: false };
  }

  let currentWeek = availableWeeks.find(
    (w) => w.startDate <= today && w.endDate >= today
  );
  if (!currentWeek) {
    const defaultWeek = availableWeeks.find(
      (w) => w.id === trainingResponse.defaultWeekId
    );
    currentWeek = defaultWeek ?? availableWeeks.at(-1)!;
  }

  const todayComplete = currentWeek.completedSessions === 4;
  const currentIndex = availableWeeks.indexOf(currentWeek);
  const startIndex = todayComplete ? currentIndex : currentIndex - 1;

  let count = 0;
  for (let i = startIndex; i >= 0; i -= 1) {
    if (availableWeeks[i].completedSessions === 4) {
      count += 1;
    } else {
      break;
    }
  }

  return { count, todayComplete };
}

export async function readCreatineDates(
  habitsGateway: HabitsGateway
): Promise<Set<string>> {
  const escapedName = HABITS_SHEET_NAME.replace(/'/g, "''");
  const [rows] = await habitsGateway.readRanges(
    [`'${escapedName}'!A:B`],
    'UNFORMATTED_VALUE'
  );
  const dates = new Set<string>();
  for (let i = 1; i < (rows ?? []).length; i += 1) {
    const isoDate = parseDateCell((rows ?? [])[i]?.[0]);
    const habit = cellText((rows ?? [])[i]?.[1]);
    if (isoDate && habit === CREATINE_HABIT_KEY) {
      dates.add(isoDate);
    }
  }
  return dates;
}

export async function logCreatine(
  habitsGateway: HabitsGateway,
  request: CreatineLogRequest
): Promise<void> {
  const escapedName = HABITS_SHEET_NAME.replace(/'/g, "''");
  const [rows] = await habitsGateway.readRanges(
    [`'${escapedName}'!A:B`],
    'UNFORMATTED_VALUE'
  );
  const dataRows = rows ?? [];

  if (request.operation === 'log') {
    const alreadyLogged = dataRows.some((row, index) => {
      if (index === 0) return false;
      return (
        parseDateCell(row?.[0]) === request.date &&
        cellText(row?.[1]) === CREATINE_HABIT_KEY
      );
    });
    if (!alreadyLogged) {
      const nextRow = dataRows.length + 1;
      await habitsGateway.writeRange(
        HABITS_SHEET_NAME,
        `A${nextRow}:B${nextRow}`,
        [request.date, CREATINE_HABIT_KEY]
      );
    }
  } else {
    for (let i = 1; i < dataRows.length; i += 1) {
      if (
        parseDateCell(dataRows[i]?.[0]) === request.date &&
        cellText(dataRows[i]?.[1]) === CREATINE_HABIT_KEY
      ) {
        await habitsGateway.clearRange(
          HABITS_SHEET_NAME,
          `A${i + 1}:B${i + 1}`
        );
        break;
      }
    }
  }
}

export async function computeStreaks({
  habitsGateway,
  bodyweightGateway,
  trainingGateway,
  today,
}: {
  habitsGateway: HabitsGateway;
  bodyweightGateway: BodyTrackingGateway;
  trainingGateway: TrainingWeeksGateway;
  today: string;
}): Promise<StreaksResponse> {
  const [creatineDates, bodyweightResponse, trainingResponse] = await Promise.all([
    readCreatineDates(habitsGateway),
    readBodyweight(bodyweightGateway),
    readTrainingWeeks(trainingGateway),
  ]);

  const creatineStreak = consecutiveStreak(creatineDates, today);

  const bodyweightDates = new Set(
    bodyweightResponse.entries.filter((e) => e.hasValue).map((e) => e.date)
  );
  const bodyweightStreak = consecutiveStreak(bodyweightDates, today);

  const todayBodyweightEntry = bodyweightResponse.entries.find(
    (e) => e.date === today
  );
  const bodyweightPrompt =
    todayBodyweightEntry && !todayBodyweightEntry.hasValue
      ? { date: today }
      : null;

  const workoutStreak = computeWorkoutStreakFromWeeks(trainingResponse, today);

  const streaks: StreakSummary[] = [
    {
      key: 'creatine',
      count: creatineStreak.count,
      unit: 'day',
      active: creatineStreak.count > 0,
      todayComplete: creatineStreak.todayComplete,
    },
    {
      key: 'bodyweight',
      count: bodyweightStreak.count,
      unit: 'day',
      active: bodyweightStreak.count > 0,
      todayComplete: bodyweightStreak.todayComplete,
    },
    {
      key: 'workouts',
      count: workoutStreak.count,
      unit: 'week',
      active: workoutStreak.count > 0,
      todayComplete: workoutStreak.todayComplete,
    },
  ];

  return { today, streaks, bodyweightPrompt };
}

function parseDateCell(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(SHEETS_EPOCH_UTC + Math.floor(value) * 86_400_000);
    return date.toISOString().slice(0, 10);
  }
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return value.trim();
  }
  return null;
}

function cellText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
