import type {
  LiftDetail,
  LiftLogRequest,
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
  writeRange(
    sheetName: string,
    range: string,
    values: readonly unknown[]
  ): Promise<void>;
  clearRange(sheetName: string, range: string): Promise<void>;
}

export class SourceSpreadsheetSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SourceSpreadsheetSchemaError';
  }
}

export class LiftLogConflictError extends Error {
  constructor(message = 'The Lift Log changed since it was loaded.') {
    super(message);
    this.name = 'LiftLogConflictError';
  }
}

interface ProgrammedLift {
  id: string;
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
  rowIndex: number;
  lifts: ProgrammedLift[] | null;
  values: unknown[];
  displayValues: unknown[];
}

interface ParsedSession {
  name: SessionName;
  weeks: ParsedWeek[];
}

export async function readTrainingWeeks(
  gateway: TrainingWeeksGateway
): Promise<TrainingWeeksResponse> {
  const sessions = await readParsedSessions(gateway);
  const weeks = sessions[0].weeks.map((week, weekIndex) =>
    summarizeWeek(week.id, weekIndex + 1, sessions, weekIndex)
  );
  addLiftContext(weeks);
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

async function readParsedSessions(
  gateway: TrainingWeeksGateway
): Promise<ParsedSession[]> {
  const gridRanges = SESSION_NAMES.map((name) => `'${name}'!A:AP`);
  const formattedGridRanges = SESSION_NAMES.map((name) => `'${name}'!A:AP`);
  const unformattedGrids = await gateway.readRanges(
    gridRanges,
    'UNFORMATTED_VALUE'
  );
  const formattedGrids = await gateway.readRanges(
    formattedGridRanges,
    'FORMATTED_VALUE'
  );

  if (
    unformattedGrids.length !== SESSION_NAMES.length ||
    formattedGrids.length !== SESSION_NAMES.length
  ) {
    throw new SourceSpreadsheetSchemaError(
      'The required Workout Session tabs could not be read.'
    );
  }

  const sessions = SESSION_NAMES.map((name, index) =>
    parseSession(name, unformattedGrids[index], formattedGrids[index])
  );
  validateMatchingWeekSequences(sessions);
  return sessions;
}

function parseSession(
  name: SessionName,
  rawRows: unknown[][],
  formattedRows: unknown[][]
): ParsedSession {
  const candidates: Array<{
    lifts: ProgrammedLift[] | null;
    rowIndex: number;
    values: unknown[];
    displayValues: unknown[];
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
      formattedRows,
      definitionRow,
      weekHeaderRow
    );
    for (
      let weekRow = weekHeaderRow + 1;
      weekRow < nextDefinitionRow;
      weekRow += 1
    ) {
      const displayedDate = cellText(formattedRows[weekRow]?.[0]);
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
        rowIndex: weekRow,
        values: rawRows[weekRow] ?? [],
        displayValues: formattedRows[weekRow] ?? [],
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
      rowIndex: candidate.rowIndex,
      lifts: candidate.lifts,
      values: candidate.values,
      displayValues: candidate.displayValues,
    })),
  };
}

function parseProgramDefinition(
  rawRows: unknown[][],
  formattedRows: unknown[][],
  definitionRow: number,
  weekHeaderRow: number
): ProgrammedLift[] | null {
  const lifts: ProgrammedLift[] = [];
  const idCounts = new Map<string, number>();
  let invalid = false;

  for (
    let groupStart = 0;
    groupStart < LIFT_GROUP_WIDTH * MAX_LIFT_GROUPS;
    groupStart += LIFT_GROUP_WIDTH
  ) {
    const name = cellText(formattedRows[definitionRow]?.[groupStart + 1]);
    if (!name) {
      continue;
    }

    const fields = new Map<string, unknown>();
    for (let rowIndex = definitionRow + 1; rowIndex < weekHeaderRow; rowIndex += 1) {
      const label = cellText(rawRows[rowIndex]?.[groupStart]);
      if (label) {
        fields.set(label, formattedRows[rowIndex]?.[groupStart + 1]);
      }
    }

    const setCount = parseWholeNumber(fields.get('Sets'));
    const repTarget = cellText(fields.get('Reps'));
    if (setCount === null || setCount < 1 || setCount > 4 || !repTarget) {
      invalid = true;
      continue;
    }
    const idBase = slugifyLiftName(name);
    const occurrence = (idCounts.get(idBase) ?? 0) + 1;
    idCounts.set(idBase, occurrence);
    lifts.push({
      id: occurrence === 1 ? idBase : `${idBase}-${occurrence}`,
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
      sessionWeeks[sessionIndex].values,
      sessionWeeks[sessionIndex].displayValues
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
  values: readonly unknown[],
  displayValues: readonly unknown[]
): SessionSummary {
  const liftDetails = lifts.map((lift) =>
    detailLift(lift, values, displayValues)
  );
  const completedLifts = liftDetails.filter(
    (lift) => lift.status === 'complete'
  ).length;

  return {
    name,
    status: summarizeStatuses(liftDetails.map((lift) => lift.status)),
    completedLifts,
    totalLifts: lifts.length,
    lifts: liftDetails,
  };
}

function detailLift(
  lift: ProgrammedLift,
  values: readonly unknown[],
  displayValues: readonly unknown[]
): LiftDetail {
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
  const hasLoggedData =
    !isBlank(weight) || allSetCells.some((value) => !isBlank(value));
  const progressionOutcome = complete
    ? evaluateProgression(lift, weight, requiredSetCells)
    : null;

  return {
    id: lift.id,
    revision: liftRevision(lift, weight, allSetCells),
    name: lift.name,
    status: complete ? 'complete' : hasLoggedData ? 'partial' : 'not-started',
    progression: lift.progression,
    setCount: lift.setCount,
    repTarget: lift.repTarget,
    proximityToFailure: lift.proximityToFailure,
    cue: lift.cue,
    weight: displayCell(displayValues[lift.groupStart + 1]),
    setResults: Array.from({ length: lift.setCount }, (_, index) =>
      displayCell(displayValues[lift.groupStart + 2 + index])
    ),
    previousLog: null,
    progressionPrompt: null,
    progressionAchievement: progressionOutcome
      ? { message: 'Progression target reached for next week.' }
      : null,
  };
}

export async function writeLiftLog(
  gateway: TrainingWeeksGateway,
  request: LiftLogRequest
): Promise<TrainingWeeksResponse> {
  const sessions = await readParsedSessions(gateway);
  const session = sessions.find((candidate) => candidate.name === request.session);
  const week = session?.weeks.find((candidate) => candidate.id === request.weekId);
  const lift = week?.lifts?.find((candidate) => candidate.id === request.liftId);

  if (!session || !week || !lift) {
    throw new LiftLogConflictError('The programmed lift is no longer available.');
  }

  const currentWeight = week.values[lift.groupStart + 1];
  const currentSets = week.values.slice(
    lift.groupStart + 2,
    lift.groupStart + LIFT_GROUP_WIDTH
  );
  if (liftRevision(lift, currentWeight, currentSets) !== request.revision) {
    throw new LiftLogConflictError();
  }

  const startColumn = columnName(lift.groupStart + 1);
  const endColumn = columnName(lift.groupStart + 5);
  const row = week.rowIndex + 1;
  const range = `${startColumn}${row}:${endColumn}${row}`;

  if (request.operation === 'clear') {
    await gateway.clearRange(session.name, range);
  } else {
    if (
      !isPositiveDecimal(request.weight) ||
      request.setResults.length !== lift.setCount ||
      !request.setResults.every(isNonNegativeWholeNumber)
    ) {
      throw new TypeError('A complete valid Lift Log is required.');
    }
    await gateway.writeRange(session.name, range, [
      request.weight,
      ...request.setResults,
      ...Array.from({ length: 4 - request.setResults.length }, () => ''),
    ]);
  }

  const response = await readTrainingWeeks(gateway);
  const updatedLift = response.weeks
    .find((candidate) => candidate.id === request.weekId)
    ?.sessions.find((candidate) => candidate.name === request.session)
    ?.lifts.find((candidate) => candidate.id === request.liftId);

  const confirmed =
    request.operation === 'clear'
      ? updatedLift?.status === 'not-started'
      : updatedLift?.status === 'complete' &&
        Number(updatedLift.weight) === request.weight &&
        updatedLift.setResults.every(
          (result, index) => Number(result) === request.setResults[index]
        );
  if (!confirmed) {
    throw new Error('The Source Spreadsheet did not confirm the Lift Log write.');
  }
  return response;
}

function addLiftContext(weeks: TrainingWeekSummary[]): void {
  for (let weekIndex = 0; weekIndex < weeks.length; weekIndex += 1) {
    const week = weeks[weekIndex];
    if (week.availability !== 'available') {
      continue;
    }
    for (const session of week.sessions) {
      for (const lift of session.lifts) {
        for (let priorIndex = weekIndex - 1; priorIndex >= 0; priorIndex -= 1) {
          const priorWeek = weeks[priorIndex];
          const priorSession = priorWeek.sessions.find(
            (candidate) => candidate.name === session.name
          );
          if (!priorSession) {
            continue;
          }
          const loggedCandidates = priorSession.lifts.filter(hasLoggedLiftData);
          const previous = matchHistoricalLift(lift.name, loggedCandidates);
          if (previous) {
            lift.previousLog = {
              weekId: priorWeek.id,
              weekNumber: priorWeek.weekNumber,
              weight: previous.weight ?? '',
              setResults: previous.setResults.map((result) => result ?? '—'),
            };
            break;
          }
        }

        for (let priorIndex = weekIndex - 1; priorIndex >= 0; priorIndex -= 1) {
          const priorWeek = weeks[priorIndex];
          const priorSession = priorWeek.sessions.find(
            (candidate) => candidate.name === session.name
          );
          if (!priorSession) {
            continue;
          }
          const previous = matchHistoricalLift(lift.name, priorSession.lifts);
          if (!previous || previous.status !== 'complete') {
            continue;
          }
          const outcome = evaluateProgression(
            previous,
            previous.weight,
            previous.setResults
          );
          if (outcome) {
            lift.progressionPrompt = {
              message: `Eligible to progress based on Week ${priorWeek.weekNumber}.`,
              recommendedWeight: outcome.recommendedWeight,
              sourceWeekNumber: priorWeek.weekNumber,
            };
          }
          break;
        }
      }
    }
  }
}

function hasLoggedLiftData(lift: LiftDetail): boolean {
  return lift.weight !== null || lift.setResults.some((result) => result !== null);
}

function matchHistoricalLift(
  currentName: string,
  candidates: LiftDetail[]
): LiftDetail | null {
  const current = canonicalLiftName(currentName);
  const exact = candidates.filter(
    (candidate) => canonicalLiftName(candidate.name) === current
  );
  if (exact.length === 1) {
    return exact[0];
  }
  if (exact.length > 1) {
    return null;
  }

  const ranked = candidates
    .map((candidate) => ({
      candidate,
      score: similarity(current, canonicalLiftName(candidate.name)),
    }))
    .sort((left, right) => right.score - left.score);
  if (
    !ranked[0] ||
    ranked[0].score < 0.82 ||
    (ranked[1] && ranked[0].score - ranked[1].score < 0.08)
  ) {
    return null;
  }
  return ranked[0].candidate;
}

function evaluateProgression(
  lift: Pick<ProgrammedLift, 'progression' | 'repTarget'>,
  rawWeight: unknown,
  rawSetResults: readonly unknown[]
): { recommendedWeight: string | null } | null {
  const reps = rawSetResults.map((result) => Number(result));
  const target = parseRepTarget(lift.repTarget);
  const scheme = lift.progression
    .toLowerCase()
    .replace(/[–—]/g, '-')
    .replace(/[^a-z0-9/]+/g, ' ')
    .trim();
  let eligible = false;
  let recommendation = true;

  if (scheme === 'dynamic dp' && target.maximum !== null) {
    eligible = reps[0] >= target.maximum;
  } else if (scheme === 'standard dp' && target.maximum !== null) {
    eligible = reps.every((rep) => rep >= target.maximum!);
  } else if (scheme === 'all set rep floor' || scheme === 'all set floor') {
    eligible = target.floor !== null && reps.every((rep) => rep >= target.floor!);
  } else if (scheme === 'top/backoff' && target.maximum !== null) {
    eligible =
      target.floor !== null &&
      reps[0] >= target.floor &&
      reps.slice(1).every((rep) => rep >= target.maximum!);
  } else if (scheme === 'five five three amrap' || scheme === '5/5/3/amrap') {
    eligible = reps.at(-1)! >= 3;
    recommendation = false;
  } else if (scheme === 'static rep linear' || scheme === 'block intensity') {
    eligible = target.floor !== null && reps.every((rep) => rep >= target.floor!);
  }

  if (!eligible) {
    return null;
  }
  const weight = Number(rawWeight);
  const recommendedWeight = recommendation
    ? String(Math.round((weight * 1.05) / 5) * 5)
    : null;
  return {
    recommendedWeight,
  };
}

function parseRepTarget(value: string): {
  floor: number | null;
  maximum: number | null;
} {
  const normalized = value.trim().replace(/[–—]/g, '-');
  const bounded = /^(\d+)\s*-\s*(\d+)$/.exec(normalized);
  if (bounded) {
    return { floor: Number(bounded[1]), maximum: Number(bounded[2]) };
  }
  const floor = /^(\d+)\s*\+?$/.exec(normalized);
  return floor
    ? { floor: Number(floor[1]), maximum: normalized.includes('+') ? null : Number(floor[1]) }
    : { floor: null, maximum: null };
}

function liftRevision(
  lift: ProgrammedLift,
  weight: unknown,
  setResults: readonly unknown[]
): string {
  return stableHash(
    JSON.stringify([
      lift.id,
      lift.name,
      lift.progression,
      lift.setCount,
      lift.repTarget,
      lift.proximityToFailure,
      lift.cue,
      cellText(weight),
      ...setResults.map(cellText),
    ])
  );
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function slugifyLiftName(value: string): string {
  return canonicalLiftName(value).replace(/\s+/g, '-') || 'lift';
}

function canonicalLiftName(value: string): string {
  const aliases: Record<string, string> = {
    bb: 'barbell',
    db: 'dumbbell',
    ng: 'neutral grip',
  };
  return value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map((token) => aliases[token] ?? token)
    .join(' ');
}

function similarity(left: string, right: string): number {
  const longest = Math.max(left.length, right.length);
  if (longest === 0) {
    return 1;
  }
  const rows = Array.from({ length: left.length + 1 }, (_, index) => index);
  for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
    let diagonal = rows[0];
    rows[0] = rightIndex;
    for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
      const previous = rows[leftIndex];
      rows[leftIndex] = Math.min(
        rows[leftIndex] + 1,
        rows[leftIndex - 1] + 1,
        diagonal + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1)
      );
      diagonal = previous;
    }
  }
  return 1 - rows[left.length] / longest;
}

function columnName(zeroBasedIndex: number): string {
  let value = zeroBasedIndex + 1;
  let result = '';
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
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

function displayCell(value: unknown): string | null {
  return isBlank(value) ? null : cellText(value);
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
