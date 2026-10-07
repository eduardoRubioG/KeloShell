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

/** The plain-language message services attach to a SourceSpreadsheetSchemaError. */
export const FORMAT_MESSAGE = 'The Source Spreadsheet structure could not be interpreted.';

export class SourceSpreadsheetSchemaError extends Error {
  readonly problems: readonly FormatProblem[];

  constructor(message: string, problems: readonly FormatProblem[] = []) {
    super(message);
    this.name = 'SourceSpreadsheetSchemaError';
    this.problems = problems;
  }
}

/**
 * Logs Source Spreadsheet problems from a service. Problems are logged in
 * services, not adapters, so they surface in the Cloudflare logs whichever
 * Coach Template reported them. Does nothing for an empty list.
 */
export function logFormatProblems(
  tag: string,
  event: string,
  problems: readonly FormatProblem[]
): void {
  if (problems.length > 0) {
    console.warn(`[${tag}] source spreadsheet problems`, { event, problems });
  }
}
