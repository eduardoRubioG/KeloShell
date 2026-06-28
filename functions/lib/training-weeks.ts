import type {
  SessionName,
  SessionStatus,
  SessionSummary,
  TrainingWeekStatus,
  TrainingWeeksResponse,
  TrainingWeekSummary,
} from '../../src/contracts/training';

export const SESSION_NAMES = [
  'Upper A',
  'Lower A',
  'Upper B',
  'Lower B',
] as const satisfies readonly SessionName[];

const LIFT_GROUP_WIDTH = 6;
const MAX_LIFT_GROUPS = 7;
const SHEETS_EPOCH_UTC = Date.UTC(1899, 11, 30);

export interface TrainingWeeksGateway {
  readRanges(
    ranges: readonly string[],
    valueRenderOption: 'FORMATTED_VALUE' | 'UNFORMATTED_VALUE'
  ): Promise<unknown[][][]>;
}

export class SourceSpreadsheetSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SourceSpreadsheetSchemaError';
  }
}

interface ProgrammedLift {
  groupStart: number;
  name: string;
  progression: string;
  setCount: number;
  repTarget: string;
  proximityToFailure: string;
  cue: string;
}

interface ParsedWeek {
  id: string;
  lifts: ProgrammedLift[] | null;
  values: unknown[];
}

interface ParsedSession {
  name: SessionName;
  weeks: ParsedWeek[];
}

export async function readTrainingWeeks(
  gateway: TrainingWeeksGateway
): Promise<TrainingWeeksResponse> {
  const gridRanges = SESSION_NAMES.map((name) => `'${name}'!A:AP`);
  const dateRanges = SESSION_NAMES.map((name) => `'${name}'!A:A`);
  const unformattedGrids = await gateway.readRanges(
    gridRanges,
    'UNFORMATTED_VALUE'
  );
  const formattedDateColumns = await gateway.readRanges(
    dateRanges,
    'FORMATTED_VALUE'
  );

  if (
    unformattedGrids.length !== SESSION_NAMES.length ||
    formattedDateColumns.length !== SESSION_NAMES.length
  ) {
    throw new SourceSpreadsheetSchemaError(
      'The required Workout Session tabs could not be read.'
    );
  }

  const sessions = SESSION_NAMES.map((name, index) =>
    parseSession(name, unformattedGrids[index], formattedDateColumns[index])
  );
  validateMatchingWeekSequences(sessions);

  const weeks = sessions[0].weeks.map((week, weekIndex) =>
    summarizeWeek(week.id, weekIndex + 1, sessions, weekIndex)
  );
  const availableWeeks = weeks.filter(
    (week) => week.availability === 'available'
  );
  const firstUnfinished = availableWeeks.find(
    (week) => week.status !== 'complete'
  );

  return {
    defaultWeekId:
      firstUnfinished?.id ?? availableWeeks.at(-1)?.id ?? null,
    weeks,
  };
}

function parseSession(
  name: SessionName,
  rawRows: unknown[][],
  formattedDateRows: unknown[][]
): ParsedSession {
  const candidates: Array<{
    lifts: ProgrammedLift[] | null;
    values: unknown[];
    displayedDate: string;
    rawDate: unknown;
  }> = [];

  for (let definitionRow = 0; definitionRow < rawRows.length; definitionRow += 1) {
    if (cellText(rawRows[definitionRow]?.[0]) !== 'Lift') {
      continue;
    }

    const nextDefinitionRow = findNextLabelRow(
      rawRows,
      definitionRow + 1,
      'Lift'
    );
    const weekHeaderRow = findLabelRow(
      rawRows,
      definitionRow + 1,
      Math.min(nextDefinitionRow, definitionRow + 10),
      'Week'
    );
    if (weekHeaderRow === -1) {
      throw new SourceSpreadsheetSchemaError(
        `${name} contains a Program Definition without a Week header.`
      );
    }

    const lifts = parseProgramDefinition(
      rawRows,
      definitionRow,
      weekHeaderRow
    );
    for (
      let weekRow = weekHeaderRow + 1;
      weekRow < nextDefinitionRow;
      weekRow += 1
    ) {
      const displayedDate = cellText(formattedDateRows[weekRow]?.[0]);
      const rawDate = rawRows[weekRow]?.[0];
      if (!displayedDate && isBlank(rawDate)) {
        continue;
      }
      if (!displayedDate) {
        throw new SourceSpreadsheetSchemaError(
          `${name} contains a week row without a readable date.`
        );
      }
      candidates.push({
        lifts,
        values: rawRows[weekRow] ?? [],
        displayedDate,
        rawDate,
      });
    }
  }

  if (candidates.length === 0) {
    throw new SourceSpreadsheetSchemaError(
      `${name} does not contain any Training Week rows.`
    );
  }

  const ids = normalizeWeekDates(
    candidates.map(({ displayedDate, rawDate }) => ({
      displayedDate,
      rawDate,
    }))
  );
  const uniqueIds = new Set(ids);
  if (uniqueIds.size !== ids.length) {
    throw new SourceSpreadsheetSchemaError(
      `${name} contains duplicate Training Week dates.`
    );
  }

  return {
    name,
    weeks: candidates.map((candidate, index) => ({
      id: ids[index],
      lifts: candidate.lifts,
      values: candidate.values,
    })),
  };
}

function parseProgramDefinition(
  rows: unknown[][],
  definitionRow: number,
  weekHeaderRow: number
): ProgrammedLift[] | null {
  const lifts: ProgrammedLift[] = [];
  let invalid = false;

  for (
    let groupStart = 0;
    groupStart < LIFT_GROUP_WIDTH * MAX_LIFT_GROUPS;
    groupStart += LIFT_GROUP_WIDTH
  ) {
    const name = cellText(rows[definitionRow]?.[groupStart + 1]);
    if (!name) {
      continue;
    }

    const fields = new Map<string, unknown>();
    for (let rowIndex = definitionRow + 1; rowIndex < weekHeaderRow; rowIndex += 1) {
      const label = cellText(rows[rowIndex]?.[groupStart]);
      if (label) {
        fields.set(label, rows[rowIndex]?.[groupStart + 1]);
      }
    }

    const setCount = parseWholeNumber(fields.get('Sets'));
    const repTarget = cellText(fields.get('Reps'));
    if (setCount === null || setCount < 1 || setCount > 4 || !repTarget) {
      invalid = true;
      continue;
    }
    lifts.push({
      groupStart,
      name,
      progression: cellText(fields.get('Progression')),
      setCount,
      repTarget,
      proximityToFailure: cellText(fields.get('Prox. to Failure')),
      cue: cellText(fields.get('Cue')),
    });
  }

  return invalid || lifts.length === 0 ? null : lifts;
}

function normalizeWeekDates(
  dates: readonly { displayedDate: string; rawDate: unknown }[]
): string[] {
  const firstRawDate = serialDateToUtc(dates[0].rawDate);
  const firstDisplayed = parseMonthDay(dates[0].displayedDate);
  if (!firstRawDate || !firstDisplayed) {
    throw new SourceSpreadsheetSchemaError(
      'The first Training Week date is not a valid spreadsheet date.'
    );
  }

  let year = firstRawDate.getUTCFullYear();
  let previousOrdinal = 0;
  return dates.map(({ displayedDate }) => {
    const monthDay = parseMonthDay(displayedDate);
    if (!monthDay) {
      throw new SourceSpreadsheetSchemaError(
        `Training Week date "${displayedDate}" is not month/day formatted.`
      );
    }
    const ordinal = monthDay.month * 100 + monthDay.day;
    if (previousOrdinal > 0 && ordinal < previousOrdinal) {
      year += 1;
    }
    previousOrdinal = ordinal;

    const date = new Date(Date.UTC(year, monthDay.month - 1, monthDay.day));
    if (
      date.getUTCMonth() !== monthDay.month - 1 ||
      date.getUTCDate() !== monthDay.day
    ) {
      throw new SourceSpreadsheetSchemaError(
        `Training Week date "${displayedDate}" is not a calendar date.`
      );
    }
    return formatIsoDate(date);
  });
}

function summarizeWeek(
  id: string,
  weekNumber: number,
  sessions: readonly ParsedSession[],
  weekIndex: number
): TrainingWeekSummary {
  const sessionWeeks = sessions.map((session) => session.weeks[weekIndex]);
  if (sessionWeeks.some((week) => week.lifts === null)) {
    return {
      id,
      weekNumber,
      startDate: id,
      endDate: addDays(id, 6),
      availability: 'unavailable',
      status: null,
      completedSessions: 0,
      sessions: [],
    };
  }

  const summaries = sessions.map((session, sessionIndex) =>
    summarizeSession(
      session.name,
      sessionWeeks[sessionIndex].lifts!,
      sessionWeeks[sessionIndex].values
    )
  );
  const completedSessions = summaries.filter(
    (session) => session.status === 'complete'
  ).length;

  return {
    id,
    weekNumber,
    startDate: id,
    endDate: addDays(id, 6),
    availability: 'available',
    status: summarizeStatuses(summaries.map((session) => session.status)),
    completedSessions,
    sessions: summaries,
  };
}

function summarizeSession(
  name: SessionName,
  lifts: readonly ProgrammedLift[],
  values: readonly unknown[]
): SessionSummary {
  let completedLifts = 0;
  let hasLoggedData = false;

  for (const lift of lifts) {
    const weight = values[lift.groupStart + 1];
    const allSetCells = values.slice(
      lift.groupStart + 2,
      lift.groupStart + LIFT_GROUP_WIDTH
    );
    const requiredSetCells = allSetCells.slice(0, lift.setCount);
    const complete =
      isPositiveDecimal(weight) &&
      requiredSetCells.length === lift.setCount &&
      requiredSetCells.every(isNonNegativeWholeNumber);
    if (complete) {
      completedLifts += 1;
    }
    if (!isBlank(weight) || allSetCells.some((value) => !isBlank(value))) {
      hasLoggedData = true;
    }
  }

  let status: SessionStatus = 'not-started';
  if (completedLifts === lifts.length) {
    status = 'complete';
  } else if (hasLoggedData) {
    status = 'partial';
  }

  return { name, status, completedLifts, totalLifts: lifts.length };
}

function summarizeStatuses(
  statuses: readonly SessionStatus[]
): TrainingWeekStatus {
  if (statuses.every((status) => status === 'complete')) {
    return 'complete';
  }
  if (statuses.some((status) => status !== 'not-started')) {
    return 'partial';
  }
  return 'not-started';
}

function validateMatchingWeekSequences(sessions: readonly ParsedSession[]): void {
  const expected = sessions[0].weeks.map((week) => week.id);
  for (const session of sessions.slice(1)) {
    const actual = session.weeks.map((week) => week.id);
    if (
      actual.length !== expected.length ||
      actual.some((id, index) => id !== expected[index])
    ) {
      throw new SourceSpreadsheetSchemaError(
        'Workout Session tabs do not contain the same Training Week sequence.'
      );
    }
  }
}

function findNextLabelRow(
  rows: readonly unknown[][],
  start: number,
  label: string
): number {
  const row = findLabelRow(rows, start, rows.length, label);
  return row === -1 ? rows.length : row;
}

function findLabelRow(
  rows: readonly unknown[][],
  start: number,
  end: number,
  label: string
): number {
  for (let index = start; index < end; index += 1) {
    if (cellText(rows[index]?.[0]) === label) {
      return index;
    }
  }
  return -1;
}

function serialDateToUtc(value: unknown): Date | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return new Date(SHEETS_EPOCH_UTC + Math.floor(value) * 86_400_000);
}

function parseMonthDay(value: string): { month: number; day: number } | null {
  const match = /^(\d{1,2})\/(\d{1,2})(?:\/\d{2,4})?$/.exec(value.trim());
  if (!match) {
    return null;
  }
  return { month: Number(match[1]), day: Number(match[2]) };
}

function formatIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return formatIsoDate(date);
}

function cellText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || cellText(value) === '';
}

function parseWholeNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(cellText(value));
  return Number.isInteger(parsed) ? parsed : null;
}

function isPositiveDecimal(value: unknown): boolean {
  const parsed = typeof value === 'number' ? value : Number(cellText(value));
  return Number.isFinite(parsed) && parsed > 0;
}

function isNonNegativeWholeNumber(value: unknown): boolean {
  const parsed = parseWholeNumber(value);
  return parsed !== null && parsed >= 0;
}
