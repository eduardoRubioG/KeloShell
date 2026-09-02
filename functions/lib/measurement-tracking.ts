import type {
  MeasurementCheckInEntry,
  MeasurementCheckInSaveRequest,
  MeasurementCheckInStatus,
  MeasurementField,
  MeasurementsResponse,
} from '../../src/contracts/measurements';
import { BODYWEIGHT_SHEET_NAME, SourceSpreadsheetSchemaError } from './config';

const SHEETS_EPOCH_UTC = Date.UTC(1899, 11, 30);
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

export interface MeasurementTrackingGateway {
  readRanges(
    ranges: readonly string[],
    valueRenderOption: 'FORMATTED_VALUE' | 'UNFORMATTED_VALUE'
  ): Promise<unknown[][][]>;
  writeRange(
    sheetName: string,
    range: string,
    values: readonly unknown[]
  ): Promise<void>;
}

export class MeasurementCheckInConflictError extends Error {
  constructor(message = 'The measurement check-in changed since it was loaded.') {
    super(message);
    this.name = 'MeasurementCheckInConflictError';
  }
}

interface ParsedField {
  id: string;
  label: string;
  columnIndex: number;
}

interface ParsedCheckInRow {
  isoDate: string;
  label: string;
  rowIndex: number;
  rawValues: unknown[];
  formattedValues: unknown[];
}

interface ParsedSheet {
  headerRow: number;
  unitLabel: string | null;
  fields: ParsedField[];
  rows: ParsedCheckInRow[];
}

async function readParsedSheet(
  gateway: MeasurementTrackingGateway
): Promise<ParsedSheet> {
  const escapedName = BODYWEIGHT_SHEET_NAME.replace(/'/g, "''");
  const sheetRange = `'${escapedName}'!G:Z`;
  const [unformatted] = await gateway.readRanges([sheetRange], 'UNFORMATTED_VALUE');
  const [formatted] = await gateway.readRanges([sheetRange], 'FORMATTED_VALUE');

  if (!unformatted || !formatted) {
    throw new SourceSpreadsheetSchemaError('The Measurement Check-In tab could not be read.');
  }

  const headerRow = unformatted.findIndex((row) => cellText(row?.[0]) === 'Month');
  if (headerRow === -1) {
    throw new SourceSpreadsheetSchemaError(
      'The Measurement Check-In section does not contain a Month header row.'
    );
  }

  const fields = parseFields(unformatted[headerRow]);
  if (fields.length === 0) {
    throw new SourceSpreadsheetSchemaError(
      'The Measurement Check-In section does not contain any Measurement Fields.'
    );
  }

  const monthDays: string[] = [];
  const rows: ParsedCheckInRow[] = [];

  for (let rowIndex = headerRow + 1; rowIndex < unformatted.length; rowIndex += 1) {
    const monthDay = measurementMonthDay(unformatted[rowIndex]?.[0]);
    if (!monthDay) {
      continue;
    }
    monthDays.push(monthDay);
    rows.push({
      isoDate: '',
      label: displayCell(formatted[rowIndex]?.[0]) ?? monthDay,
      rowIndex,
      rawValues: fields.map((field) => unformatted[rowIndex]?.[field.columnIndex]),
      formattedValues: fields.map((field) => formatted[rowIndex]?.[field.columnIndex]),
    });
  }

  if (rows.length === 0) {
    throw new SourceSpreadsheetSchemaError(
      'The Measurement Check-In section does not contain any scheduled dates.'
    );
  }

  const isoDates = anchorMonthDaysToIsoDates(monthDays);
  rows.forEach((row, index) => {
    row.isoDate = isoDates[index] ?? row.isoDate;
  });

  return {
    headerRow,
    unitLabel: findUnitLabel(unformatted.slice(0, headerRow), formatted.slice(0, headerRow)),
    fields,
    rows,
  };
}

export async function saveMeasurementCheckIn(
  gateway: MeasurementTrackingGateway,
  request: MeasurementCheckInSaveRequest
): Promise<MeasurementsResponse> {
  const parsed = await readParsedSheet(gateway);
  const row = parsed.rows.find((entry) => entry.isoDate === request.date);

  if (!row) {
    throw new MeasurementCheckInConflictError('That date is not in the Source Spreadsheet.');
  }

  const currentRevision = checkInRevision(row.isoDate, row.rawValues);
  if (currentRevision !== request.revision) {
    throw new MeasurementCheckInConflictError();
  }

  const fieldById = new Map(parsed.fields.map((field) => [field.id, field]));
  const entries = Object.entries(request.values);
  if (entries.length === 0) {
    throw new TypeError('At least one measurement value is required.');
  }

  for (const [fieldId, value] of entries) {
    const field = fieldById.get(fieldId);
    if (!field) {
      throw new TypeError(`Unknown measurement field: ${fieldId}`);
    }
    if (!isPositiveDecimal(value)) {
      throw new TypeError('All measurement values must be positive numbers.');
    }
    const cellRef = `${columnLetterFromGOffset(field.columnIndex)}${row.rowIndex + 1}`;
    await gateway.writeRange(BODYWEIGHT_SHEET_NAME, cellRef, [value]);
  }

  const response = await readMeasurements(gateway);
  const updated = response.checkIns.find((checkIn) => checkIn.date === request.date);
  for (const [fieldId, value] of entries) {
    const saved = updated?.values[fieldId];
    if (saved === null || saved === undefined || Number(saved) !== value) {
      throw new Error('The Source Spreadsheet did not confirm the measurement write.');
    }
  }

  return response;
}

export async function readMeasurements(
  gateway: MeasurementTrackingGateway
): Promise<MeasurementsResponse> {
  const parsed = await readParsedSheet(gateway);

  return {
    tabAvailable: true,
    unitLabel: parsed.unitLabel,
    fields: parsed.fields.map(({ id, label }) => ({ id, label })),
    checkIns: parsed.rows.map((row) => {
      const values = Object.fromEntries(
        parsed.fields.map((field, index) => {
          const raw = row.rawValues[index];
          const hasValue = isPositiveDecimal(raw);
          return [
            field.id,
            hasValue ? displayCell(row.formattedValues[index]) : null,
          ] as const;
        })
      );

      return {
        date: row.isoDate,
        label: row.label,
        status: deriveCheckInStatus(values, parsed.fields),
        values,
        revision: checkInRevision(row.isoDate, row.rawValues),
      };
    }),
  };
}

export function deriveCheckInStatus(
  values: Record<string, string | null>,
  fields: readonly Pick<MeasurementField, 'id'>[]
): MeasurementCheckInStatus {
  const filled = fields.filter((field) => values[field.id] !== null).length;
  if (filled === 0) {
    return 'empty';
  }
  if (filled === fields.length) {
    return 'complete';
  }
  return 'partial';
}

function parseFields(headerRow: unknown[] | undefined): ParsedField[] {
  if (!headerRow) {
    return [];
  }

  const fields: ParsedField[] = [];
  for (let columnIndex = 1; columnIndex < headerRow.length; columnIndex += 1) {
    const label = cellText(headerRow[columnIndex]);
    if (!label) {
      break;
    }
    fields.push({
      id: fieldIdFromLabel(label),
      label,
      columnIndex,
    });
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

function anchorMonthDaysToIsoDates(monthDays: readonly string[]): string[] {
  if (monthDays.length === 0) {
    return [];
  }

  const today = new Date();
  let year = today.getFullYear();
  let previousMonthDay: string | null = null;
  const isoDates: string[] = [];

  for (const monthDay of monthDays) {
    if (previousMonthDay !== null && monthDay < previousMonthDay) {
      year += 1;
    }
    isoDates.push(`${year}-${monthDay}`);
    previousMonthDay = monthDay;
  }

  return isoDates;
}

function findUnitLabel(
  unformattedRows: unknown[][],
  formattedRows: unknown[][]
): string | null {
  for (let rowIndex = 0; rowIndex < unformattedRows.length; rowIndex += 1) {
    const row = unformattedRows[rowIndex] ?? [];
    for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
      const text = cellText(row[columnIndex]).toLowerCase();
      if (text === 'units' || text === 'unit') {
        const next = cellText(row[columnIndex + 1]) || cellText(formattedRows[rowIndex]?.[columnIndex + 1]);
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
    return spreadsheetDate(value)?.slice(5) ?? null;
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

function spreadsheetDate(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return new Date(SHEETS_EPOCH_UTC + Math.floor(value) * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

function checkInRevision(isoDate: string, rawValues: readonly unknown[]): string {
  return stableHash(JSON.stringify([isoDate, ...rawValues.map((value) => cellText(value))]));
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

function isPositiveDecimal(value: unknown): boolean {
  const parsed = typeof value === 'number' ? value : Number(cellText(value));
  return Number.isFinite(parsed) && parsed > 0;
}

function columnLetterFromGOffset(offset: number): string {
  let columnNumber = 7 + offset;
  let label = '';
  while (columnNumber > 0) {
    const remainder = (columnNumber - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    columnNumber = Math.floor((columnNumber - 1) / 26);
  }
  return label;
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export type { MeasurementCheckInEntry };
