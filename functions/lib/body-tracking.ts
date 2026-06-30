import type {
  BodyweightResponse,
  DailyBodyweightRequest,
} from '../../src/contracts/body';
import { BODYWEIGHT_SHEET_NAME, SourceSpreadsheetSchemaError } from './config';

const SHEETS_EPOCH_UTC = Date.UTC(1899, 11, 30);

export interface BodyTrackingGateway {
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

export class BodyweightConflictError extends Error {
  constructor(message = 'The bodyweight data changed since it was loaded.') {
    super(message);
    this.name = 'BodyweightConflictError';
  }
}

interface ParsedEntry {
  isoDate: string;
  rowIndex: number;
  rawWeight: unknown;
  formattedWeight: unknown;
}

async function readParsedEntries(
  gateway: BodyTrackingGateway
): Promise<ParsedEntry[]> {
  const escapedName = BODYWEIGHT_SHEET_NAME.replace(/'/g, "''");
  const sheetRange = `'${escapedName}'!A:B`;
  const [unformatted] = await gateway.readRanges([sheetRange], 'UNFORMATTED_VALUE');
  const [formatted] = await gateway.readRanges([sheetRange], 'FORMATTED_VALUE');

  if (!unformatted || !formatted) {
    throw new SourceSpreadsheetSchemaError('The Bodyweight tab could not be read.');
  }

  let headerRow = -1;
  for (let i = 0; i < unformatted.length; i += 1) {
    if (
      cellText(unformatted[i]?.[0]) === 'Date' &&
      cellText(unformatted[i]?.[1]) === 'Weight'
    ) {
      headerRow = i;
      break;
    }
  }
  if (headerRow === -1) {
    throw new SourceSpreadsheetSchemaError(
      'The Bodyweight tab does not contain a Date/Weight header row.'
    );
  }

  const entries: ParsedEntry[] = [];
  for (let rowIndex = headerRow + 1; rowIndex < unformatted.length; rowIndex += 1) {
    const rawDate = unformatted[rowIndex]?.[0];
    if (isBlank(rawDate)) {
      continue;
    }
    const date = serialDateToUtc(rawDate);
    if (!date) {
      continue;
    }
    entries.push({
      isoDate: formatIsoDate(date),
      rowIndex,
      rawWeight: unformatted[rowIndex]?.[1],
      formattedWeight: formatted[rowIndex]?.[1],
    });
  }
  return entries;
}

export async function readBodyweight(
  gateway: BodyTrackingGateway
): Promise<BodyweightResponse> {
  const entries = await readParsedEntries(gateway);
  return {
    tabAvailable: true,
    entries: entries.map((entry) => {
      const hasValue = isPositiveDecimal(entry.rawWeight);
      return {
        date: entry.isoDate,
        weight: hasValue ? displayCell(entry.formattedWeight) : null,
        hasValue,
        revision: entryRevision(entry.isoDate, entry.rawWeight),
      };
    }),
  };
}

export async function writeDailyBodyweight(
  gateway: BodyTrackingGateway,
  request: DailyBodyweightRequest
): Promise<BodyweightResponse> {
  const parsed = await readParsedEntries(gateway);
  const entry = parsed.find((e) => e.isoDate === request.date);

  if (!entry) {
    throw new BodyweightConflictError('That date is not in the Source Spreadsheet.');
  }

  const currentRevision = entryRevision(entry.isoDate, entry.rawWeight);
  if (currentRevision !== request.revision) {
    throw new BodyweightConflictError();
  }

  const cellRef = `B${entry.rowIndex + 1}`;
  if (request.operation === 'clear') {
    await gateway.clearRange(BODYWEIGHT_SHEET_NAME, cellRef);
  } else {
    if (!isPositiveDecimal(request.weight)) {
      throw new TypeError('A positive weight value is required.');
    }
    await gateway.writeRange(BODYWEIGHT_SHEET_NAME, cellRef, [request.weight]);
  }

  const response = await readBodyweight(gateway);
  const updated = response.entries.find((e) => e.date === request.date);
  const confirmed =
    request.operation === 'clear'
      ? updated && !updated.hasValue
      : updated?.hasValue && Number(updated.weight) === request.weight;

  if (!confirmed) {
    throw new Error('The Source Spreadsheet did not confirm the bodyweight write.');
  }
  return response;
}

function entryRevision(isoDate: string, rawWeight: unknown): string {
  return stableHash(JSON.stringify([isoDate, cellText(rawWeight)]));
}

function serialDateToUtc(value: unknown): Date | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return new Date(SHEETS_EPOCH_UTC + Math.floor(value) * 86_400_000);
}

function formatIsoDate(date: Date): string {
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

function isPositiveDecimal(value: unknown): boolean {
  const parsed = typeof value === 'number' ? value : Number(cellText(value));
  return Number.isFinite(parsed) && parsed > 0;
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
