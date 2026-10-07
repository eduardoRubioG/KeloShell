import type {
  BodyweightResponse,
  DailyBodyweightEntry,
  DailyBodyweightRequest,
} from '../../../src/contracts/body';
import { BodyweightConflictError } from '../../lib/body-errors';
import { SourceSpreadsheetSchemaError, type FormatProblem } from '../../lib/format-problems';
import type { SpreadsheetGateway } from '../../lib/spreadsheet-gateway';
import type { TrackingReport, TrackingTemplate } from '../types';
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
const TRACKING_RANGE = 'A:G';
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
}

export const coachPartnerTracking: TrackingTemplate = {
  readTracking,
  writeDailyBodyweight,
};

async function readTracking(
  gateway: SpreadsheetGateway,
  today: string
): Promise<TrackingReport> {
  return buildReport(await discoverTabs(gateway), today);
}

async function discoverTabs(gateway: SpreadsheetGateway): Promise<TrackingTab[]> {
  const titles = await gateway.listSheetTitles();
  const ranges = titles.map((title) => `'${title.replace(/'/g, "''")}'!${TRACKING_RANGE}`);
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

async function writeDailyBodyweight(
  gateway: SpreadsheetGateway,
  request: DailyBodyweightRequest
): Promise<BodyweightResponse> {
  // Past dates live in whichever tab holds them, not necessarily the current one.
  const found = groupByDate(await discoverTabs(gateway)).get(request.date);
  if (!found) {
    throw new BodyweightConflictError('That date is not in the Source Spreadsheet.');
  }
  if (found.length > 1) {
    throw new SourceSpreadsheetSchemaError(
      `The date ${request.date} appears in more than one Tracking tab.`,
      duplicateProblems(request.date, found)
    );
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
  return { tabAvailable: report.tabAvailable, entries: report.entries };
}

function parseTrackingTab(
  title: string,
  rawRows: readonly unknown[][],
  formattedRows: readonly unknown[][]
): TrackingTab | null {
  const headerRow = rawRows.findIndex(
    (row) => cellText(row?.[0]) === 'Date' && cellText(row?.[1]) === 'Weight'
  );
  const hasMonthHeader = rawRows.some(
    (row) => cellText(row?.[MONTH_COLUMN]) === 'Month'
  );
  if (headerRow === -1 || !hasMonthHeader) {
    return null;
  }

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
  return { title, entries };
}
