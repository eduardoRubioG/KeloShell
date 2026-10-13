import type { CoachTemplate } from '../functions/coach-templates/types';
import type { SpreadsheetGateway } from '../functions/lib/spreadsheet-gateway';
import {
  validateSourceSpreadsheet,
  type ValidationReport,
} from '../functions/services/validation';

export interface ValidateSheetResult {
  output: string;
  exitCode: 0 | 1;
}

/** Formats a Validation report for the operator: exit code 1 when any problem exists. */
export function formatValidationReport(report: ValidationReport): ValidateSheetResult {
  const lines: string[] = [];
  const list = (items: readonly string[]) =>
    items.length === 0
      ? ['  (none)']
      : items.map((item, index) => `  ${index + 1}. ${item}`);

  lines.push(`Workout Sessions (${report.sessions.length}, in Session Order)`);
  lines.push(...list(report.sessions));
  lines.push('');
  lines.push(`Tracking tabs (${report.trackingTabs.length})`);
  lines.push(...list(report.trackingTabs));
  lines.push('');
  lines.push(`Current Tracking tab for ${report.date}: ${report.currentTrackingTab ?? '(none)'}`);
  lines.push('');
  lines.push(`Problems (${report.problems.length})`);
  if (report.problems.length === 0) {
    lines.push('  (none)');
  }
  for (const problem of report.problems) {
    lines.push(
      `  [${problem.code}] tab: ${problem.tab ?? '-'}, cell: ${problem.cell ?? '-'}: ${problem.message}`
    );
  }
  lines.push('');
  lines.push(report.problems.length === 0 ? 'OK' : 'FAILED');

  return { output: lines.join('\n'), exitCode: report.problems.length === 0 ? 0 : 1 };
}

/** The script's core: validate through the Validation service, then format. */
export async function runValidateSheet(
  gateway: SpreadsheetGateway,
  template: CoachTemplate,
  date: string
): Promise<ValidateSheetResult> {
  return formatValidationReport(await validateSourceSpreadsheet(gateway, template, date));
}

export interface ValidateSheetArgs {
  spreadsheetId: string;
  /** YYYY-MM-DD, or undefined for today in the reminder time zone. */
  date?: string;
}

export const USAGE = 'Usage: npm run validate-sheet -- <spreadsheetId> [YYYY-MM-DD]';

export function parseValidateSheetArgs(argv: readonly string[]): ValidateSheetArgs {
  const [spreadsheetId, date, ...rest] = argv;
  if (!spreadsheetId || rest.length > 0) {
    throw new Error(USAGE);
  }
  if (date !== undefined) {
    const valid =
      /^\d{4}-\d{2}-\d{2}$/.test(date) &&
      new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
    if (!valid) {
      throw new Error(`Invalid date "${date}": expected YYYY-MM-DD.\n${USAGE}`);
    }
  }
  return { spreadsheetId, date };
}
