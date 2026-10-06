/**
 * A violated Source Spreadsheet format rule. `cell` is A1 notation (`A12`) or a
 * range (`B3:G3`); `tab` is null only for whole-spreadsheet problems.
 */
export interface FormatProblem {
  code: string;
  tab: string | null;
  cell: string | null;
  message: string;
}

export class SourceSpreadsheetSchemaError extends Error {
  readonly problems: readonly FormatProblem[];

  constructor(message: string, problems: readonly FormatProblem[] = []) {
    super(message);
    this.name = 'SourceSpreadsheetSchemaError';
    this.problems = problems;
  }
}
