import type {
  LiftDetail,
  LiftLogRequest,
  SessionName,
  SessionStatus,
  SessionSummary,
  TrainingWeekStatus,
  TrainingWeeksResponse,
  TrainingWeekSummary,
} from '../../../src/contracts/training';
import { SourceSpreadsheetSchemaError } from '../../lib/format-problems';
import { LiftLogConflictError, UnknownWorkoutSessionError } from '../../lib/lift-log-errors';
import type { SpreadsheetGateway } from '../../lib/spreadsheet-gateway';
import type { FormatProblem } from '../../lib/format-problems';
import type { TrainingReport, TrainingTemplate } from '../types';

const LIFT_GROUP_WIDTH = 6;
// Widened from 7 to 14: a Workout Session with more than 7 lift blocks used to
// silently lose its trailing exercises because the sheet range and this scan
// limit both capped out at 7 blocks (42 columns, A:AP).
const MAX_LIFT_GROUPS = 14;
const SHEETS_EPOCH_UTC = Date.UTC(1899, 11, 30);


interface ProgrammedLift {
  id: string;
  groupStart: number;
  name: string;
  progression: string;
  /** Required (lower-bound) set count; equals setCount for a single number. */
  minSetCount: number;
  /** Rendered (upper-bound) set count. */
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

export const coachPartnerTraining: TrainingTemplate = {
  readTraining: async (gateway) => toReport(await analyzeSpreadsheet(gateway)),
  writeLiftLog,
};

function buildTrainingWeeks(
  sessions: readonly ParsedSession[]
): TrainingWeeksResponse {
  const weeks = sessions[0].weeks.map((week, weekIndex) =>
    summarizeWeek(week.id, weekIndex + 1, sessions, weekIndex)
  );
  addLiftContext(weeks);
  const availableWeeks = weeks.filter(
    (week) => week.availability === 'available'
  );

  return {
    defaultWeekId: pickDefaultWeek(availableWeeks)?.id ?? null,
    weeks,
  };
}

/**
 * Resumes at the most recently touched week. A week left permanently
 * partial by an intentionally skipped session must not trap the default
 * there forever once later weeks are underway, so a *complete* last-touched
 * week advances to whatever comes next; a still-partial one stays put.
 * Nothing touched yet defaults to the first available week.
 */
function pickDefaultWeek(
  availableWeeks: readonly TrainingWeekSummary[]
): TrainingWeekSummary | undefined {
  for (let index = availableWeeks.length - 1; index >= 0; index -= 1) {
    const week = availableWeeks[index];
    if (week.status === 'not-started') {
      continue;
    }
    return week.status === 'complete'
      ? availableWeeks[index + 1] ?? week
      : week;
  }
  return availableWeeks[0];
}

const NON_BLOCKING_CODES = new Set([
  'lift-missing-name',
  'lift-missing-rep-target',
  'set-count-out-of-range',
]);
const REQUIRED_PROGRAM_FIELDS = ['Progression', 'Sets', 'Reps'] as const;

interface Analysis {
  sessionNames: string[];
  sessions: ParsedSession[];
  problems: FormatProblem[];
}

const isBlocking = (problem: FormatProblem) =>
  !NON_BLOCKING_CODES.has(problem.code);

function hasBlockingProblem(analysis: Analysis): boolean {
  return analysis.sessions.length === 0 || analysis.problems.some(isBlocking);
}

function toReport(analysis: Analysis): TrainingReport {
  if (hasBlockingProblem(analysis)) {
    return {
      ok: false,
      sessions: analysis.sessionNames,
      problems: analysis.problems,
    };
  }
  return {
    ok: true,
    sessions: analysis.sessionNames,
    trainingWeeks: buildTrainingWeeks(analysis.sessions),
    problems: analysis.problems,
  };
}

function requireUsable(analysis: Analysis): ParsedSession[] {
  if (hasBlockingProblem(analysis)) {
    throw new SourceSpreadsheetSchemaError(
      analysis.problems.find(isBlocking)?.message ??
        'The Source Spreadsheet structure could not be interpreted.',
      analysis.problems
    );
  }
  return analysis.sessions;
}

async function analyzeSpreadsheet(gateway: SpreadsheetGateway): Promise<Analysis> {
  const tabNames = await gateway.listSheetTitles();
  const ranges = tabNames.map((name) => `'${name.replace(/'/g, "''")}'!A:CF`);
  const unformattedGrids = ranges.length
    ? await gateway.readRanges(ranges, 'UNFORMATTED_VALUE')
    : [];
  const formattedGrids = ranges.length
    ? await gateway.readRanges(ranges, 'FORMATTED_VALUE')
    : [];

  if (
    unformattedGrids.length !== tabNames.length ||
    formattedGrids.length !== tabNames.length
  ) {
    throw new SourceSpreadsheetSchemaError(
      'The required Workout Session tabs could not be read.',
      [
        {
          code: 'unreadable-tabs',
          tab: null,
          cell: null,
          message:
            'The Source Spreadsheet returned a different number of tab grids than were requested, so the Workout Session tabs could not be read. Retry; if it persists, check the spreadsheet is shared with the service account.',
        },
      ]
    );
  }

  const problems: FormatProblem[] = [];
  const discovered: string[] = [];
  const sessions: ParsedSession[] = [];
  tabNames.forEach((name, index) => {
    if (!hasLiftRow(unformattedGrids[index])) {
      return;
    }
    discovered.push(name);
    const session = parseSession(
      name,
      unformattedGrids[index],
      formattedGrids[index],
      problems
    );
    if (session) {
      sessions.push(session);
    }
  });
  if (discovered.length === 0) {
    problems.push({
      code: 'no-workout-sessions',
      tab: null,
      cell: null,
      message:
        'The Source Spreadsheet contains no Workout Sessions (no tab has a "Lift" row in column A).',
    });
  }
  validateMatchingWeekSequences(sessions, problems);
  return { sessionNames: discovered, sessions, problems };
}

function hasLiftRow(rows: readonly unknown[][]): boolean {
  return findLabelRow(rows, 0, rows.length, 'Lift') !== -1;
}

function cellRef(columnIndex: number, rowIndex: number): string {
  return `${columnName(columnIndex)}${rowIndex + 1}`;
}

/** Returns null when the tab has a blocking problem (already reported). */
function parseSession(
  name: SessionName,
  rawRows: unknown[][],
  formattedRows: unknown[][],
  problems: FormatProblem[]
): ParsedSession | null {
  let blocked = false;
  const block = (problem: FormatProblem) => {
    blocked = true;
    problems.push(problem);
  };
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
    const liftCell = cellRef(0, definitionRow);
    if (weekHeaderRow === -1) {
      block({
        code: 'missing-week-header',
        tab: name,
        cell: liftCell,
        message: `${name}: the Program Definition at ${liftCell} has no "Week" header row below it. Add a "Week" header row before the weekly rows.`,
      });
      continue;
    }

    const missingFields = REQUIRED_PROGRAM_FIELDS.filter(
      (field) =>
        findLabelRow(rawRows, definitionRow + 1, weekHeaderRow, field) === -1
    );
    if (missingFields.length > 0) {
      for (const field of missingFields) {
        block({
          code: 'missing-program-field',
          tab: name,
          cell: liftCell,
          message: `${name}: the Program Definition at ${liftCell} has no "${field}" row between "Lift" and "Week".`,
        });
      }
      continue;
    }

    const lifts = parseProgramDefinition(
      name,
      rawRows,
      formattedRows,
      definitionRow,
      weekHeaderRow,
      problems
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
        block({
          code: 'unreadable-week-date',
          tab: name,
          cell: cellRef(0, weekRow),
          message: `${name}: the Training Week row at ${cellRef(0, weekRow)} has no readable date.`,
        });
        continue;
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
    if (!blocked) {
      block({
        code: 'no-week-rows',
        tab: name,
        cell: null,
        message: `${name} does not contain any Training Week rows.`,
      });
    }
    return null;
  }

  const ids = normalizeWeekDates(name, candidates, block);
  const seen = new Set<string>();
  ids.forEach((id, index) => {
    if (id === null) {
      return;
    }
    if (seen.has(id)) {
      const cell = cellRef(0, candidates[index].rowIndex);
      block({
        code: 'duplicate-week-date',
        tab: name,
        cell,
        message: `${name}: the Training Week date at ${cell} (${id}) appears more than once.`,
      });
    }
    seen.add(id);
  });
  if (blocked) {
    return null;
  }

  return {
    name,
    weeks: candidates.map((candidate, index) => ({
      id: ids[index]!,
      rowIndex: candidate.rowIndex,
      lifts: candidate.lifts,
      values: candidate.values,
      displayValues: candidate.displayValues,
    })),
  };
}

function parseProgramDefinition(
  tab: string,
  rawRows: unknown[][],
  formattedRows: unknown[][],
  definitionRow: number,
  weekHeaderRow: number,
  problems: FormatProblem[]
): ProgrammedLift[] | null {
  const lifts: ProgrammedLift[] = [];
  const idCounts = new Map<string, number>();
  let invalid = false;
  const report = (code: string, cell: string, message: string) => {
    invalid = true;
    problems.push({ code, tab, cell, message: `${tab}: ${message}` });
  };

  for (
    let groupStart = 0;
    groupStart < LIFT_GROUP_WIDTH * MAX_LIFT_GROUPS;
    groupStart += LIFT_GROUP_WIDTH
  ) {
    const name = cellText(formattedRows[definitionRow]?.[groupStart + 1]);

    const fields = new Map<string, unknown>();
    const fieldRows = new Map<string, number>();
    for (let rowIndex = definitionRow + 1; rowIndex < weekHeaderRow; rowIndex += 1) {
      const label = cellText(rawRows[rowIndex]?.[groupStart]);
      if (label) {
        fields.set(label, formattedRows[rowIndex]?.[groupStart + 1]);
        fieldRows.set(label, rowIndex);
      }
    }
    const valueCell = (label: string) =>
      cellRef(groupStart + 1, fieldRows.get(label) ?? definitionRow);

    if (!name) {
      if (!isBlank(fields.get('Sets')) || !isBlank(fields.get('Reps'))) {
        const cell = cellRef(groupStart + 1, definitionRow);
        report(
          'lift-missing-name',
          cell,
          `the lift programmed in column ${columnName(groupStart + 1)} has no name at ${cell}.`
        );
      }
      continue;
    }

    const setSpec = parseSetSpec(fields.get('Sets'));
    const repTarget = cellText(fields.get('Reps'));
    if (setSpec === null) {
      report(
        'set-count-out-of-range',
        valueCell('Sets'),
        `"${name}" at ${valueCell('Sets')} needs a Sets value of 1 to 4 (or a range like 2-3).`
      );
    }
    if (!repTarget) {
      report(
        'lift-missing-rep-target',
        valueCell('Reps'),
        `"${name}" has no Rep Target at ${valueCell('Reps')}.`
      );
    }
    if (setSpec === null || !repTarget) {
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
      minSetCount: setSpec.minSetCount,
      setCount: setSpec.setCount,
      repTarget,
      proximityToFailure: cellText(fields.get('Prox. to Failure')),
      cue: cellText(fields.get('Cue')),
    });
  }

  return invalid || lifts.length === 0 ? null : lifts;
}

/** Week ids (ISO dates) per candidate; null where the date is invalid (reported). */
function normalizeWeekDates(
  tab: string,
  candidates: readonly {
    rowIndex: number;
    displayedDate: string;
    rawDate: unknown;
  }[],
  block: (problem: FormatProblem) => void
): (string | null)[] {
  const invalidDate = (index: number, detail: string) => {
    const cell = cellRef(0, candidates[index].rowIndex);
    block({
      code: 'invalid-week-date',
      tab,
      cell,
      message: `${tab}: the Training Week date at ${cell} ${detail}.`,
    });
  };

  const firstRawDate = serialDateToUtc(candidates[0].rawDate);
  const firstDisplayed = parseMonthDay(candidates[0].displayedDate);
  if (!firstRawDate || !firstDisplayed) {
    invalidDate(0, 'is not a valid spreadsheet date');
    return candidates.map(() => null);
  }

  let year = firstRawDate.getUTCFullYear();
  let previousOrdinal = 0;
  return candidates.map(({ displayedDate }, index) => {
    const monthDay = parseMonthDay(displayedDate);
    if (!monthDay) {
      invalidDate(index, `("${displayedDate}") is not month/day formatted`);
      return null;
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
      invalidDate(index, `("${displayedDate}") is not a calendar date`);
      return null;
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
  const requiredSetCells = allSetCells.slice(0, lift.minSetCount);
  const complete =
    isPositiveDecimal(weight) &&
    requiredSetCells.length === lift.minSetCount &&
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
    minSetCount: lift.minSetCount,
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

async function writeLiftLog(
  gateway: SpreadsheetGateway,
  request: LiftLogRequest
): Promise<TrainingWeeksResponse> {
  const analysis = await analyzeSpreadsheet(gateway);
  const sessions = requireUsable(analysis);
  if (!analysis.sessionNames.includes(request.session)) {
    throw new UnknownWorkoutSessionError(request.session);
  }
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
      request.setResults.length < lift.minSetCount ||
      request.setResults.length > lift.setCount ||
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

  const response = buildTrainingWeeks(
    requireUsable(await analyzeSpreadsheet(gateway))
  );
  const updatedLift = response.weeks
    .find((candidate) => candidate.id === request.weekId)
    ?.sessions.find((candidate) => candidate.name === request.session)
    ?.lifts.find((candidate) => candidate.id === request.liftId);

  const confirmed =
    request.operation === 'clear'
      ? updatedLift?.status === 'not-started'
      : updatedLift?.status === 'complete' &&
        Number(updatedLift.weight) === request.weight &&
        request.setResults.every(
          (result, index) => Number(updatedLift.setResults[index]) === result
        ) &&
        updatedLift.setResults
          .slice(request.setResults.length)
          .every(isBlank);
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
      lift.minSetCount,
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

function validateMatchingWeekSequences(
  sessions: readonly ParsedSession[],
  problems: FormatProblem[]
): void {
  if (sessions.length === 0) {
    return;
  }
  const baseline = sessions[0];
  for (const session of sessions.slice(1)) {
    const length = Math.max(baseline.weeks.length, session.weeks.length);
    for (let index = 0; index < length; index += 1) {
      if (baseline.weeks[index]?.id === session.weeks[index]?.id) {
        continue;
      }
      const row = session.weeks[index]?.rowIndex;
      problems.push({
        code: 'week-dates-mismatch',
        tab: session.name,
        cell: row === undefined ? null : cellRef(0, row),
        message: `${session.name} does not have the same Training Week dates as ${baseline.name}; the weeks must line up across every Workout Session tab.`,
      });
      break;
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

/**
 * Parses a Sets specification: either a single whole number ("3") or a range
 * ("2-3", lower-upper). Returns the required (lower) and rendered (upper) set
 * counts, or null if malformed or outside the supported 1-4 range. Sets above
 * the lower bound are logged as optional.
 */
function parseSetSpec(
  value: unknown
): { minSetCount: number; setCount: number } | null {
  const match = cellText(value).match(/^(\d+)\s*[-–]\s*(\d+)$/);
  if (match) {
    const min = Number(match[1]);
    const max = Number(match[2]);
    if (min < 1 || max > 4 || min > max) {
      return null;
    }
    return { minSetCount: min, setCount: max };
  }
  const single = parseWholeNumber(value);
  if (single === null || single < 1 || single > 4) {
    return null;
  }
  return { minSetCount: single, setCount: single };
}

function isPositiveDecimal(value: unknown): boolean {
  const parsed = typeof value === 'number' ? value : Number(cellText(value));
  return Number.isFinite(parsed) && parsed > 0;
}

function isNonNegativeWholeNumber(value: unknown): boolean {
  const parsed = parseWholeNumber(value);
  return parsed !== null && parsed >= 0;
}
