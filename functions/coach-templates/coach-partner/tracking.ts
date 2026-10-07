import type {
  DailyBodyweightEntry,
  DailyBodyweightRequest,
} from '../../../src/contracts/body';
import type { MeasurementCheckInSaveRequest } from '../../../src/contracts/measurements';
import { BodyweightConflictError, MeasurementCheckInConflictError } from '../../lib/body-errors';
import type { FormatProblem } from '../../lib/format-problems';
import { tabRange, type SpreadsheetGateway } from '../../lib/spreadsheet-gateway';
import type {
  MeasurementCheckInWriteResult,
  MeasurementsReport,
  TrackingReport,
  TrackingTemplate,
  TrackingWriteResult,
} from '../types';
import {
  buildMeasurementsReport,
  duplicateMeasurementDateProblem,
  locateMeasurementCheckIns,
  type MeasurementTabInput,
} from './measurements';
import {
  cellText,
  displayCell,
  formatIsoDate,
  isBlank,
  isPositiveDecimal,
  serialDateToUtc,
  stableHash,
} from './cells';

// A Tracking tab is found by structure: a Date/Weight header row in columns
// A:B and a Month header somewhere in column G (the Measurement Check-In
// section, which can sit in a different row).
const TRACKING_RANGE = 'A:Z';
const MONTH_COLUMN = 6;

interface TrackingEntry {
  entry: DailyBodyweightEntry;
  tab: string;
  cell: string;
  /** 1-based sheet row of the entry. */
  row: number;
}

interface TrackingTab {
  title: string;
  entries: TrackingEntry[];
  /** 0-based row of the Month header, -1 when the tab has none. */
  monthHeaderRow: number;
  rawRows: readonly unknown[][];
  formattedRows: readonly unknown[][];
}

export const coachPartnerTracking: TrackingTemplate = {
  readTracking,
  writeDailyBodyweight,
  readMeasurements,
  writeMeasurementCheckIn,
};

async function readTracking(
  gateway: SpreadsheetGateway,
  today: string
): Promise<TrackingReport> {
  return buildReport(await discoverTabs(gateway), today);
}

async function discoverTabs(gateway: SpreadsheetGateway): Promise<TrackingTab[]> {
  return (await discoverDateWeightTabs(gateway)).filter(
    (tab) => tab.monthHeaderRow !== -1
  );
}

// Every tab with a Date/Weight header, including ones missing a Month header.
async function discoverDateWeightTabs(
  gateway: SpreadsheetGateway
): Promise<TrackingTab[]> {
  const titles = await gateway.listSheetTitles();
  const ranges = titles.map((title) => tabRange(title, TRACKING_RANGE));
  const unformatted = ranges.length
    ? await gateway.readRanges(ranges, 'UNFORMATTED_VALUE')
    : [];
  const formatted = ranges.length
    ? await gateway.readRanges(ranges, 'FORMATTED_VALUE')
    : [];

  const tabs: TrackingTab[] = [];
  titles.forEach((title, index) => {
    const tab = parseTrackingTab(
      title,
      unformatted[index] ?? [],
      formatted[index] ?? []
    );
    if (tab) {
      tabs.push(tab);
    }
  });

  return tabs;
}

function buildReport(tabs: TrackingTab[], today: string): TrackingReport {
  if (tabs.length === 0) {
    return {
      tabAvailable: false,
      entries: [],
      todayEntry: null,
      problems: [
        {
          code: 'no-tracking-tabs',
          tab: null,
          cell: null,
          message:
            'No Tracking tab with Date/Weight headers in columns A:B and a Month header in column G was found.',
        },
      ],
    };
  }

  const problems: FormatProblem[] = [];
  const byDate = groupByDate(tabs);

  const entries: DailyBodyweightEntry[] = [];
  for (const [date, found] of byDate) {
    if (found.length > 1) {
      problems.push(...duplicateProblems(date, found));
      continue;
    }
    entries.push(found[0].entry);
  }
  entries.sort((a, b) => a.date.localeCompare(b.date));

  return {
    tabAvailable: true,
    entries,
    todayEntry: entries.find((entry) => entry.date === today) ?? null,
    problems,
  };
}

function groupByDate(tabs: TrackingTab[]): Map<string, TrackingEntry[]> {
  const byDate = new Map<string, TrackingEntry[]>();
  for (const tab of tabs) {
    for (const found of tab.entries) {
      const list = byDate.get(found.entry.date) ?? [];
      list.push(found);
      byDate.set(found.entry.date, list);
    }
  }
  return byDate;
}

// Reports every occurrence beyond the first as the offending cell.
function duplicateProblems(date: string, found: TrackingEntry[]): FormatProblem[] {
  return found.slice(1).map((duplicate) => ({
    code: 'duplicate-tracking-date',
    tab: duplicate.tab,
    cell: duplicate.cell,
    message: `The date ${date} also appears in the "${found[0].tab}" tab; it is left out until only one Tracking tab has it.`,
  }));
}

async function readMeasurements(
  gateway: SpreadsheetGateway
): Promise<MeasurementsReport> {
  return buildMeasurementsReport(measurementInputs(await discoverDateWeightTabs(gateway)));
}

function measurementInputs(tabs: readonly TrackingTab[]): MeasurementTabInput[] {
  return tabs.map((tab) => ({
    title: tab.title,
    monthHeaderRow: tab.monthHeaderRow,
    monthColumn: MONTH_COLUMN,
    rawRows: tab.rawRows,
    formattedRows: tab.formattedRows,
    firstDate: tab.entries[0]?.entry.date ?? null,
  }));
}

async function writeMeasurementCheckIn(
  gateway: SpreadsheetGateway,
  request: MeasurementCheckInSaveRequest
): Promise<MeasurementCheckInWriteResult> {
  const found = locateMeasurementCheckIns(
    measurementInputs(await discoverDateWeightTabs(gateway)),
    request.date
  );
  if (found.length === 0) {
    throw new MeasurementCheckInConflictError('That date is not in the Source Spreadsheet.');
  }
  if (found.length > 1) {
    return { ok: false, problems: [duplicateMeasurementDateProblem(request.date)] };
  }

  const [target] = found;
  if (target.revision !== request.revision) {
    throw new MeasurementCheckInConflictError();
  }

  const entries = Object.entries(request.values);
  if (entries.length === 0) {
    throw new TypeError('At least one measurement value is required.');
  }
  for (const [fieldId, value] of entries) {
    if (!target.columns.has(fieldId)) {
      throw new TypeError(`Unknown measurement field: ${fieldId}`);
    }
    if (!isPositiveDecimal(value)) {
      throw new TypeError('All measurement values must be positive numbers.');
    }
  }
  for (const [fieldId, value] of entries) {
    await gateway.writeRange(target.tab, `${target.columns.get(fieldId)}${target.row}`, [value]);
  }

  const report = await readMeasurements(gateway);
  const updated = report.ok
    ? report.response.checkIns.find((checkIn) => checkIn.date === request.date)
    : undefined;
  const confirmed = entries.every(([fieldId, value]) => {
    const saved = updated?.values[fieldId];
    return saved !== null && saved !== undefined && Number(saved) === value;
  });
  if (!report.ok || !confirmed) {
    throw new Error('The Source Spreadsheet did not confirm the measurement write.');
  }
  return { ok: true, response: report.response };
}

async function writeDailyBodyweight(
  gateway: SpreadsheetGateway,
  request: DailyBodyweightRequest
): Promise<TrackingWriteResult> {
  // Past dates live in whichever tab holds them, not necessarily the current one.
  const found = groupByDate(await discoverTabs(gateway)).get(request.date);
  if (!found) {
    throw new BodyweightConflictError('That date is not in the Source Spreadsheet.');
  }
  if (found.length > 1) {
    return { ok: false, problems: duplicateProblems(request.date, found) };
  }

  const [target] = found;
  if (target.entry.revision !== request.revision) {
    throw new BodyweightConflictError();
  }

  const cellRef = `B${target.row}`;
  if (request.operation === 'clear') {
    await gateway.clearRange(target.tab, cellRef);
  } else {
    if (!isPositiveDecimal(request.weight)) {
      throw new TypeError('A positive weight value is required.');
    }
    await gateway.writeRange(target.tab, cellRef, [request.weight]);
  }

  const report = await readTracking(gateway, request.date);
  const updated = report.entries.find((e) => e.date === request.date);
  const confirmed =
    request.operation === 'clear'
      ? updated && !updated.hasValue
      : updated?.hasValue && Number(updated.weight) === request.weight;
  if (!confirmed) {
    throw new Error('The Source Spreadsheet did not confirm the bodyweight write.');
  }
  return {
    ok: true,
    response: { tabAvailable: report.tabAvailable, entries: report.entries },
  };
}

function parseTrackingTab(
  title: string,
  rawRows: readonly unknown[][],
  formattedRows: readonly unknown[][]
): TrackingTab | null {
  const headerRow = rawRows.findIndex(
    (row) => cellText(row?.[0]) === 'Date' && cellText(row?.[1]) === 'Weight'
  );
  if (headerRow === -1) {
    return null;
  }
  const monthHeaderRow = rawRows.findIndex(
    (row) => cellText(row?.[MONTH_COLUMN]) === 'Month'
  );

  const entries: TrackingEntry[] = [];
  for (let rowIndex = headerRow + 1; rowIndex < rawRows.length; rowIndex += 1) {
    const rawDate = rawRows[rowIndex]?.[0];
    if (isBlank(rawDate)) {
      continue;
    }
    const date = serialDateToUtc(rawDate);
    if (!date) {
      continue;
    }
    const isoDate = formatIsoDate(date);
    const rawWeight = rawRows[rowIndex]?.[1];
    const hasValue = isPositiveDecimal(rawWeight);
    entries.push({
      tab: title,
      cell: `A${rowIndex + 1}`,
      row: rowIndex + 1,
      entry: {
        date: isoDate,
        weight: hasValue ? displayCell(formattedRows[rowIndex]?.[1]) : null,
        hasValue,
        revision: stableHash(JSON.stringify([isoDate, cellText(rawWeight)])),
      },
    });
  }
  return { title, entries, monthHeaderRow, rawRows, formattedRows };
}
