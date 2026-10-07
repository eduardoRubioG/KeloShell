import type { SpreadsheetGateway } from '../lib/spreadsheet-gateway';

const DAY = 86_400_000;
const SHEETS_EPOCH = Date.UTC(1899, 11, 30);

export interface FakeTabGrids {
  /** Unformatted (raw) cell values. */
  cells: unknown[][];
  /** Formatted cell values; defaults to String() of each cell. */
  formatted?: unknown[][];
}

export interface FakeTab extends FakeTabGrids {
  title: string;
}

interface StoredTab {
  title: string;
  cells: unknown[][];
  formatted: unknown[][];
}

/** In-memory Source Spreadsheet: ordered tabs with unformatted/formatted grids. */
export class FakeSpreadsheet implements SpreadsheetGateway {
  private tabs: StoredTab[];

  constructor(tabs: readonly FakeTab[]) {
    this.tabs = tabs.map((tab) => ({
      title: tab.title,
      cells: tab.cells.map((row) => [...row]),
      formatted: (
        tab.formatted ??
        tab.cells.map((row) =>
          row.map((value) => (value === undefined ? undefined : String(value)))
        )
      ).map((row) => [...row]),
    }));
  }

  get titles(): string[] {
    return this.tabs.map((tab) => tab.title);
  }

  /** Reorders tabs to the given title order. */
  reorder(titles: readonly string[]): void {
    this.tabs = titles.map((title) => this.tab(title));
  }

  rename(from: string, to: string): void {
    this.tab(from).title = to;
  }

  async listSheetTitles(): Promise<string[]> {
    return this.titles;
  }

  async readRanges(
    ranges: readonly string[],
    valueRenderOption: 'FORMATTED_VALUE' | 'UNFORMATTED_VALUE'
  ): Promise<unknown[][][]> {
    return ranges.map((range) => {
      const { title, area } = parseQualifiedRange(range);
      const tab = this.tab(title);
      const grid = valueRenderOption === 'UNFORMATTED_VALUE' ? tab.cells : tab.formatted;
      const rows = grid.slice(area.firstRow, area.lastRow + 1);
      return rows.map((row) => (row ?? []).slice(area.firstColumn, area.lastColumn + 1));
    });
  }

  async writeRange(
    sheetName: string,
    range: string,
    values: readonly unknown[]
  ): Promise<void> {
    const tab = this.tab(sheetName);
    const area = parseArea(range);
    values.forEach((value, index) => {
      setCell(tab.cells, area.firstRow, area.firstColumn + index, value);
      setCell(tab.formatted, area.firstRow, area.firstColumn + index, value);
    });
  }

  async clearRange(sheetName: string, range: string): Promise<void> {
    const tab = this.tab(sheetName);
    const area = parseArea(range);
    for (let row = area.firstRow; row <= area.lastRow; row += 1) {
      for (let column = area.firstColumn; column <= area.lastColumn; column += 1) {
        setCell(tab.cells, row, column, '');
        setCell(tab.formatted, row, column, '');
      }
    }
  }

  private tab(title: string): StoredTab {
    const tab = this.tabs.find((candidate) => candidate.title === title);
    if (!tab) {
      throw new Error(`Unable to parse range: '${title}'`);
    }
    return tab;
  }
}

function setCell(grid: unknown[][], row: number, column: number, value: unknown): void {
  grid[row] = grid[row] ?? [];
  grid[row][column] = value;
}

interface Area {
  firstRow: number;
  lastRow: number;
  firstColumn: number;
  lastColumn: number;
}

function parseQualifiedRange(range: string): { title: string; area: Area } {
  const match = /^'((?:[^']|'')+)'!(.+)$/.exec(range);
  if (!match) {
    throw new Error(`Unexpected range: ${range}`);
  }
  return { title: match[1].replace(/''/g, "'"), area: parseArea(match[2]) };
}

/** Parses `A:CF`, `B7:F7` or `B7` (1-based rows, optional) into 0-based bounds. */
function parseArea(range: string): Area {
  const match = /^([A-Z]+)(\d*)(?::([A-Z]+)(\d*))?$/.exec(range);
  if (!match) {
    throw new Error(`Unexpected range: ${range}`);
  }
  const firstColumn = columnIndex(match[1]);
  const lastColumn = match[3] ? columnIndex(match[3]) : firstColumn;
  const firstRow = match[2] ? Number(match[2]) - 1 : 0;
  const lastRow = match[4]
    ? Number(match[4]) - 1
    : match[3] || !match[2]
      ? Number.MAX_SAFE_INTEGER
      : firstRow;
  return { firstRow, lastRow, firstColumn, lastColumn };
}

function columnIndex(letters: string): number {
  let column = 0;
  for (const character of letters) {
    column = column * 26 + character.charCodeAt(0) - 64;
  }
  return column - 1;
}

// --- Workout Session fixtures -------------------------------------------

/** Tab titles of the default 4-session fixture sheet, in order. */
export const DEFAULT_SESSION_TITLES = ['Upper A', 'Lower A', 'Upper B', 'Lower B'];

export interface WeekFixture {
  displayDate: string;
  rawDate: string;
  weight?: unknown;
  sets?: unknown[];
}

export interface BlockFixture {
  liftName?: string;
  progression?: string;
  setCount?: number;
  /** Raw value for the Sets cell; overrides setCount (e.g. a "2-3" range). */
  setsCell?: unknown;
  repTarget?: unknown;
  formattedRepTarget?: string;
  weeks: WeekFixture[];
}

/** Builds the grids of a valid Workout Session tab from one-lift Program Definition blocks. */
export function workoutSessionGrids(blocks: readonly BlockFixture[]): Required<FakeTabGrids> {
  const cells: unknown[][] = [];
  const overrides: unknown[][] = [];

  for (const block of blocks) {
    cells.push(['Lift', block.liftName ?? 'Test Lift']);
    cells.push(['Progression', block.progression ?? 'Dynamic DP']);
    cells.push(['Sets', block.setsCell ?? block.setCount ?? 3]);
    cells.push(['Reps', block.repTarget ?? '6-8']);
    cells.push(['Cue', 'Controlled reps']);
    cells.push(['Week', 'Weight', 1, 2, 3, 4]);
    overrides.push(
      [],
      [],
      [],
      block.formattedRepTarget === undefined ? [] : [undefined, block.formattedRepTarget],
      [],
      []
    );

    for (const week of block.weeks) {
      cells.push([serialDate(week.rawDate), week.weight ?? '', ...(week.sets ?? [])]);
      overrides.push([week.displayDate]);
    }
  }

  return { cells, formatted: overlayFormatted(cells, overrides) };
}

// --- Tracking tab fixtures ----------------------------------------------

/** Measurement Check-In section of a Tracking tab, in columns G onward. */
export interface MeasurementFixture {
  fields: string[];
  /** [Month label, one value per field (null leaves it blank)]. */
  checkIns: readonly (readonly [string, readonly (number | null)[]])[];
}

/**
 * Grids of a Tracking tab: a title row, then the Date/Weight/.../Month header
 * row, then one row per [isoDate, weight] (null leaves the weight blank). With
 * `measurements`, the Month header is followed by its Measurement Fields and
 * check-in rows run alongside the daily rows.
 */
export function trackingTabGrid(
  rows: readonly (readonly [string, number | null])[],
  measurements?: MeasurementFixture
): Required<FakeTabGrids> {
  const cells: unknown[][] = [
    [],
    ['Date', 'Weight', '', '', '', '', 'Month', ...(measurements?.fields ?? [])],
    ...rows.map(([isoDate, weight]) => [serialDate(isoDate), weight ?? '']),
  ];
  measurements?.checkIns.forEach(([label, values], index) => {
    const row = (cells[index + 2] = cells[index + 2] ?? []);
    while (row.length < 6) {
      row.push('');
    }
    row[6] = label;
    values.forEach((value, valueIndex) => {
      row[7 + valueIndex] = value ?? '';
    });
  });
  const overrides: unknown[][] = [
    [],
    [],
    ...rows.map(([isoDate]) => {
      const [, month, day] = isoDate.split('-');
      return [`${Number(month)}/${Number(day)}`];
    }),
  ];
  return { cells, formatted: overlayFormatted(cells, overrides) };
}

/** Formatted grid equal to the raw cells, with non-undefined overrides applied on top. */
export function overlayFormatted(
  cells: readonly unknown[][],
  overrides: readonly unknown[][]
): unknown[][] {
  return cells.map((row, rowIndex) => {
    const formatted = [...row];
    for (const [columnIndex, value] of (overrides[rowIndex] ?? []).entries()) {
      if (value !== undefined) {
        formatted[columnIndex] = value;
      }
    }
    return formatted;
  });
}

/** Spreadsheet whose tabs are the given grids, titled in order (default: the 4-session split). */
export function fakeSpreadsheetOf(
  grids: readonly FakeTabGrids[],
  titles: readonly string[] = DEFAULT_SESSION_TITLES
): FakeSpreadsheet {
  return new FakeSpreadsheet(
    grids.map((grid, index) => ({ title: titles[index], ...grid }))
  );
}

export function serialDate(isoDate: string): number {
  return (Date.parse(`${isoDate}T00:00:00Z`) - SHEETS_EPOCH) / DAY;
}
