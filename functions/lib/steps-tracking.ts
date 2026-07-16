import type { StepsResponse, DailyStepsRequest } from '../../src/contracts/steps';
import { STEPS_SHEET_NAME, SourceSpreadsheetSchemaError } from './config';

const SHEETS_EPOCH_UTC = Date.UTC(1899, 11, 30);
const WINDOW_DAYS = 30;

export interface StepsGateway {
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

export class StepsConflictError extends Error {
  constructor(message = 'The steps data changed since it was loaded.') {
    super(message);
    this.name = 'StepsConflictError';
  }
}

interface ParsedRow {
  isoDate: string;
  rowIndex: number;
  rawSteps: unknown;
  formattedSteps: unknown;
}

interface ParsedSheet {
  headerRow: number;
  rowCount: number;
  rows: ParsedRow[];
}

async function readParsedSheet(gateway: StepsGateway): Promise<ParsedSheet> {
  const escapedName = STEPS_SHEET_NAME.replace(/'/g, "''");
  const sheetRange = `'${escapedName}'!A:B`;
  const [unformatted] = await gateway.readRanges([sheetRange], 'UNFORMATTED_VALUE');
  const [formatted] = await gateway.readRanges([sheetRange], 'FORMATTED_VALUE');

  if (!unformatted || !formatted) {
    throw new SourceSpreadsheetSchemaError('The Steps tab could not be read.');
  }

  let headerRow = -1;
  for (let i = 0; i < unformatted.length; i += 1) {
    if (
      cellText(unformatted[i]?.[0]) === 'Date' &&
      cellText(unformatted[i]?.[1]) === 'Steps'
    ) {
      headerRow = i;
      break;
    }
  }
  if (headerRow === -1) {
    throw new SourceSpreadsheetSchemaError(
      'The Steps tab does not contain a Date/Steps header row.'
    );
  }

  const rows: ParsedRow[] = [];
  for (let rowIndex = headerRow + 1; rowIndex < unformatted.length; rowIndex += 1) {
    const isoDate = parseDateCell(unformatted[rowIndex]?.[0]);
    if (!isoDate) {
      continue;
    }
    rows.push({
      isoDate,
      rowIndex,
      rawSteps: unformatted[rowIndex]?.[1],
      formattedSteps: formatted[rowIndex]?.[1],
    });
  }

  return { headerRow, rowCount: unformatted.length, rows };
}

export async function readSteps(
  gateway: StepsGateway,
  today: string
): Promise<StepsResponse> {
  const sheet = await readParsedSheet(gateway);
  return buildResponse(sheet, today);
}

export async function readLoggedStepsDates(
  gateway: StepsGateway
): Promise<Set<string>> {
  const sheet = await readParsedSheet(gateway);
  const dates = new Set<string>();
  for (const row of sheet.rows) {
    if (isPositiveInteger(row.rawSteps)) {
      dates.add(row.isoDate);
    }
  }
  return dates;
}

export async function writeDailySteps(
  gateway: StepsGateway,
  request: DailyStepsRequest,
  today: string
): Promise<StepsResponse> {
  const sheet = await readParsedSheet(gateway);
  const existing = sheet.rows.find((row) => row.isoDate === request.date);

  const currentRevision = entryRevision(request.date, existing?.rawSteps);
  if (currentRevision !== request.revision) {
    throw new StepsConflictError();
  }

  if (request.operation === 'clear') {
    if (existing) {
      await gateway.clearRange(STEPS_SHEET_NAME, `B${existing.rowIndex + 1}`);
    }
  } else {
    if (!isPositiveInteger(request.steps)) {
      throw new TypeError('A positive whole-number step count is required.');
    }
    if (existing) {
      await gateway.writeRange(
        STEPS_SHEET_NAME,
        `B${existing.rowIndex + 1}`,
        [request.steps]
      );
    } else {
      const nextRow = sheet.rowCount + 1;
      await gateway.writeRange(
        STEPS_SHEET_NAME,
        `A${nextRow}:B${nextRow}`,
        [request.date, request.steps]
      );
    }
  }

  const response = await readSteps(gateway, today);
  const updated = response.entries.find((entry) => entry.date === request.date);
  const confirmed =
    request.operation === 'clear'
      ? updated && !updated.hasValue
      : updated?.hasValue && Number(updated.steps) === request.steps;

  if (!confirmed) {
    throw new Error('The Steps tab did not confirm the write.');
  }
  return response;
}

function buildResponse(sheet: ParsedSheet, today: string): StepsResponse {
  const logged = new Map<string, ParsedRow>();
  for (const row of sheet.rows) {
    logged.set(row.isoDate, row);
  }

  const dates = new Set<string>(logged.keys());
  for (let offset = 0; offset < WINDOW_DAYS; offset += 1) {
    dates.add(addDays(today, -offset));
  }

  const entries = [...dates]
    .sort((left, right) => left.localeCompare(right))
    .map((date) => {
      const row = logged.get(date);
      const hasValue = row ? isPositiveInteger(row.rawSteps) : false;
      return {
        date,
        steps: hasValue ? displayCell(row?.formattedSteps) : null,
        hasValue,
        revision: entryRevision(date, row?.rawSteps),
      };
    });

  return { tabAvailable: true, today, entries };
}

function entryRevision(isoDate: string, rawSteps: unknown): string {
  return stableHash(JSON.stringify([isoDate, cellText(rawSteps)]));
}

function parseDateCell(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(SHEETS_EPOCH_UTC + Math.floor(value) * 86_400_000)
      .toISOString()
      .slice(0, 10);
  }
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return value.trim();
  }
  return null;
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
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

function isPositiveInteger(value: unknown): boolean {
  const parsed = typeof value === 'number' ? value : Number(cellText(value));
  return Number.isFinite(parsed) && parsed > 0 && Number.isInteger(parsed);
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
