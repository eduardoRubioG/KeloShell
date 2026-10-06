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
