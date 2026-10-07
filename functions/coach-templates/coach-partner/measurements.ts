import type {
  MeasurementCheckInEntry,
  MeasurementField,
  MeasurementCheckInStatus,
} from '../../../src/contracts/measurements';
import type { FormatProblem } from '../../lib/format-problems';
import type { MeasurementsReport } from '../types';
import { MONTH_COLUMN, type TrackingTab } from './tracking-tab';
import { cellText, displayCell, isPositiveDecimal, serialDateToUtc, formatIsoDate, stableHash } from './cells';

const MONTHS = new Map(
  [
    'january',
    'february',
    'march',
    'april',
    'may',
    'june',
    'july',
    'august',
    'september',
    'october',
    'november',
    'december',
  ].map((month, index) => [month, index + 1])
);

interface ParsedField extends MeasurementField {
  columnIndex: number;
}

interface PositionedCheckIn extends MeasurementCheckInEntry {
  /** 1-based sheet row of the check-in. */
  row: number;
}

interface ParsedTab {
  title: string;
  fields: ParsedField[];
  unitLabel: string | null;
  checkIns: PositionedCheckIn[];
}

/** Where a Measurement Check-In lives, for the write path. Never leaves the adapter. */
export interface CheckInLocation {
  tab: string;
  row: number;
  revision: string;
  /** Measurement Field id -> column letter in that tab. */
  columns: ReadonlyMap<string, string>;
}

/** Every tab's check-in dated `date`, with the cells to write; more than one means a duplicate. */
export function locateMeasurementCheckIns(
  tabs: readonly TrackingTab[],
  date: string
): CheckInLocation[] {
  const found: CheckInLocation[] = [];
  for (const tab of tabs) {
    const parsed = parseMeasurementTab(tab);
    if ('problem' in parsed) {
      continue;
    }
    for (const checkIn of parsed.checkIns) {
      if (checkIn.date === date) {
        found.push({
          tab: parsed.title,
          row: checkIn.row,
          revision: checkIn.revision,
          columns: new Map(
            parsed.fields.map((field) => [field.id, columnLetter(field.columnIndex)])
          ),
        });
      }
    }
  }
  return found;
}

export function duplicateMeasurementDateProblem(date: string): FormatProblem {
  return {
    code: 'duplicate-measurement-date',
    tab: null,
    cell: null,
    message: `The Measurement Check-In date ${date} appears in more than one Tracking tab; only the first is listed.`,
  };
}

export function buildMeasurementsReport(
  tabs: readonly TrackingTab[]
): MeasurementsReport {
  const problems: FormatProblem[] = [];
  const parsed: ParsedTab[] = [];

  for (const tab of tabs) {
    const result = parseMeasurementTab(tab);
    if ('problem' in result) {
      problems.push(result.problem);
    } else {
      parsed.push(result);
    }
  }

  if (parsed.length === 0) {
    if (problems.length === 0) {
      problems.push({
        code: 'no-tracking-tabs',
        tab: null,
        cell: null,
        message:
          'No Tracking tab with Date/Weight headers in columns A:B and a Month header in column G was found.',
      });
      return {
        ok: true,
        response: { tabAvailable: false, unitLabel: null, fields: [], checkIns: [] },
        problems,
      };
    }
    return { ok: false, problems };
  }

  const fields: MeasurementField[] = [];
  for (const tab of parsed) {
    for (const { id, label } of tab.fields) {
      if (!fields.some((field) => field.id === id)) {
        fields.push({ id, label });
      }
    }
  }

  const byDate = new Map<string, MeasurementCheckInEntry>();
  for (const tab of parsed) {
    for (const checkIn of tab.checkIns) {
      if (byDate.has(checkIn.date)) {
        problems.push(duplicateMeasurementDateProblem(checkIn.date));
        continue;
      }
      const { row: _row, ...entry } = checkIn;
      byDate.set(checkIn.date, {
        ...entry,
        values: Object.fromEntries(
          fields.map((field) => [field.id, checkIn.values[field.id] ?? null])
        ),
      });
    }
  }

  return {
    ok: true,
    response: {
      tabAvailable: true,
      unitLabel: parsed[parsed.length - 1].unitLabel,
      fields,
      checkIns: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)),
    },
    problems,
  };
}

function parseMeasurementTab(
  tab: TrackingTab
): ParsedTab | { problem: FormatProblem } {
  const headerRow = tab.rawRows[tab.monthHeaderRow] ?? [];
  const fields = parseFields(headerRow);
  if (fields.length === 0) {
    return {
      problem: {
        code: 'missing-measurement-fields',
        tab: tab.title,
        cell: `${columnLetter(MONTH_COLUMN)}${tab.monthHeaderRow + 1}`,
        message: `The "${tab.title}" tab has no Measurement Fields next to its Month header.`,
      },
    };
  }

  const rows: { monthDay: string; rowIndex: number }[] = [];
  for (let rowIndex = tab.monthHeaderRow + 1; rowIndex < tab.rawRows.length; rowIndex += 1) {
    const monthDay = measurementMonthDay(tab.rawRows[rowIndex]?.[MONTH_COLUMN]);
    if (monthDay) {
      rows.push({ monthDay, rowIndex });
    }
  }

  // The tab's first Date anchors the yearless Month labels.
  const firstDate = tab.entries[0]?.entry.date ?? null;
  const isoDates = anchorMonthDays(
    rows.map((row) => row.monthDay),
    firstDate ? Number(firstDate.slice(0, 4)) : null
  );
  if (rows.length > 0 && !isoDates) {
    return {
      problem: {
        code: 'unanchored-measurement-year',
        tab: tab.title,
        cell: null,
        message: `The "${tab.title}" tab has no dates in its Date column, so the year of its Measurement Check-Ins is unknown.`,
      },
    };
  }

  const checkIns = rows.map(({ monthDay, rowIndex }, index): PositionedCheckIn => {
    const isoDate = isoDates![index];
    const raw = tab.rawRows[rowIndex] ?? [];
    const formatted = tab.formattedRows[rowIndex] ?? [];
    const rawValues = fields.map((field) => raw[field.columnIndex]);
    const values = Object.fromEntries(
      fields.map((field, fieldIndex) => [
        field.id,
        isPositiveDecimal(rawValues[fieldIndex])
          ? displayCell(formatted[field.columnIndex])
          : null,
      ])
    );
    return {
      row: rowIndex + 1,
      date: isoDate,
      label: displayCell(formatted[MONTH_COLUMN]) ?? monthDay,
      status: deriveCheckInStatus(values, fields),
      values,
      revision: stableHash(
        JSON.stringify([isoDate, ...rawValues.map((value) => cellText(value))])
      ),
    };
  });

  return {
    title: tab.title,
    fields,
    unitLabel: findUnitLabel(tab.rawRows.slice(0, tab.monthHeaderRow)),
    checkIns,
  };
}

function deriveCheckInStatus(
  values: Record<string, string | null>,
  fields: readonly MeasurementField[]
): MeasurementCheckInStatus {
  const filled = fields.filter((field) => values[field.id] !== null).length;
  if (filled === 0) {
    return 'empty';
  }
  return filled === fields.length ? 'complete' : 'partial';
}

function parseFields(headerRow: readonly unknown[]): ParsedField[] {
  const fields: ParsedField[] = [];
  for (let columnIndex = MONTH_COLUMN + 1; columnIndex < headerRow.length; columnIndex += 1) {
    const label = cellText(headerRow[columnIndex]);
    if (!label) {
      break;
    }
    fields.push({ id: fieldIdFromLabel(label), label, columnIndex });
  }
  return fields;
}

function fieldIdFromLabel(label: string): string {
  const normalized = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'field';
}

// Month labels carry no year: start from the year of the tab's own first Date
// and move to the next year each time the month/day sequence wraps around.
function anchorMonthDays(
  monthDays: readonly string[],
  startYear: number | null
): string[] | null {
  if (startYear === null) {
    return null;
  }
  let year = startYear;
  let previous: string | null = null;
  return monthDays.map((monthDay) => {
    if (previous !== null && monthDay < previous) {
      year += 1;
    }
    previous = monthDay;
    return `${year}-${monthDay}`;
  });
}

function findUnitLabel(rows: readonly unknown[][]): string {
  for (const row of rows) {
    for (let columnIndex = MONTH_COLUMN; columnIndex < row.length; columnIndex += 1) {
      const text = cellText(row[columnIndex]).toLowerCase();
      if (text === 'units' || text === 'unit') {
        const next = cellText(row[columnIndex + 1]);
        if (next) {
          return next;
        }
      }
      if (text === 'in' || text === 'cm' || text === 'lbs' || text === 'lb') {
        return cellText(row[columnIndex]);
      }
    }
  }
  return 'in';
}

function measurementMonthDay(value: unknown): string | null {
  if (typeof value === 'number') {
    const date = serialDateToUtc(value);
    return date ? formatIsoDate(date).slice(5) : null;
  }
  const match = /^([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+\d{4})?$/i.exec(
    cellText(value)
  );
  if (!match) {
    return null;
  }
  const month = MONTHS.get(match[1].toLowerCase());
  const day = Number(match[2]);
  if (!month || !Number.isInteger(day)) {
    return null;
  }
  const date = new Date(Date.UTC(2000, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function columnLetter(index: number): string {
  let columnNumber = index + 1;
  let label = '';
  while (columnNumber > 0) {
    const remainder = (columnNumber - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    columnNumber = Math.floor((columnNumber - 1) / 26);
  }
  return label;
}
