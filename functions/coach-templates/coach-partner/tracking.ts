import type { DailyBodyweightEntry } from '../../../src/contracts/body';
import type { FormatProblem } from '../../lib/format-problems';
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

// A Tracking tab is found by structure: a Date/Weight header in columns A:B
// with a Month header in column G of the same row.
const TRACKING_RANGE = 'A:G';
const MONTH_COLUMN = 6;

interface TrackingEntry {
  entry: DailyBodyweightEntry;
  tab: string;
  cell: string;
}

interface TrackingTab {
  title: string;
  entries: TrackingEntry[];
}

export const coachPartnerTracking: TrackingTemplate = {
  readTracking,
};

async function readTracking(
  gateway: SpreadsheetGateway,
  today: string
): Promise<TrackingReport> {
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
  const byDate = new Map<string, TrackingEntry[]>();
  for (const tab of tabs) {
    for (const found of tab.entries) {
      const list = byDate.get(found.entry.date) ?? [];
      list.push(found);
      byDate.set(found.entry.date, list);
    }
  }

  const entries: DailyBodyweightEntry[] = [];
  for (const [date, found] of byDate) {
    if (found.length > 1) {
      // Report every occurrence beyond the first as the offending cell.
      for (const duplicate of found.slice(1)) {
        problems.push({
          code: 'duplicate-tracking-date',
          tab: duplicate.tab,
          cell: duplicate.cell,
          message: `The date ${date} also appears in the "${found[0].tab}" tab; it is left out until only one Tracking tab has it.`,
        });
      }
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

function parseTrackingTab(
  title: string,
  rawRows: readonly unknown[][],
  formattedRows: readonly unknown[][]
): TrackingTab | null {
  const headerRow = rawRows.findIndex(
    (row) =>
      cellText(row?.[0]) === 'Date' &&
      cellText(row?.[1]) === 'Weight' &&
      cellText(row?.[MONTH_COLUMN]) === 'Month'
  );
  if (headerRow === -1) {
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
