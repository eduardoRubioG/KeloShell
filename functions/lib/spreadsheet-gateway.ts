/** Raw Google Sheets I/O, with no knowledge of any Coach Template's layout. */
export interface SpreadsheetGateway {
  /** Tab titles in spreadsheet order. */
  listSheetTitles(): Promise<string[]>;
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

/** An A1 range on a tab, quoting the tab name (`'Tracking ''26'!A:G`). */
export function tabRange(tab: string, range: string): string {
  return `'${tab.replace(/'/g, "''")}'!${range}`;
}
