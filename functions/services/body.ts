import type {
  BodyweightResponse,
  DailyBodyweightEntry,
  DailyBodyweightRequest,
} from '../../src/contracts/body';
import { FORMAT_MESSAGE, SourceSpreadsheetSchemaError, type FormatProblem } from '../lib/format-problems';
import type { CoachTemplate, TrackingReport } from '../coach-templates/types';
import type { SpreadsheetGateway } from '../lib/spreadsheet-gateway';

export { BodyweightConflictError } from '../lib/body-errors';

// Problems are logged here, not in the adapter, so they surface in the
// Cloudflare logs whichever Coach Template reported them.
function logProblems(problems: readonly FormatProblem[]): void {
  if (problems.length > 0) {
    console.warn('[body] source spreadsheet problems', {
      event: 'tracking-problems',
      problems,
    });
  }
}

export async function readTrackingReport(
  gateway: SpreadsheetGateway,
  template: CoachTemplate,
  today: string
): Promise<TrackingReport> {
  const report = await template.tracking.readTracking(gateway, today);
  logProblems(report.problems);
  return report;
}

export async function readBodyweight(
  gateway: SpreadsheetGateway,
  template: CoachTemplate,
  today: string
): Promise<BodyweightResponse> {
  const report = await readTrackingReport(gateway, template, today);
  return { tabAvailable: report.tabAvailable, entries: report.entries };
}

/** Today's Daily Bodyweight, or null when it is unavailable. */
export async function readTodayBodyweight(
  gateway: SpreadsheetGateway,
  template: CoachTemplate,
  today: string
): Promise<DailyBodyweightEntry | null> {
  return (await readTrackingReport(gateway, template, today)).todayEntry;
}

export async function writeDailyBodyweight(
  gateway: SpreadsheetGateway,
  template: CoachTemplate,
  request: DailyBodyweightRequest
): Promise<BodyweightResponse> {
  const result = await template.tracking.writeDailyBodyweight(gateway, request);
  if (!result.ok) {
    logProblems(result.problems);
    throw new SourceSpreadsheetSchemaError(FORMAT_MESSAGE, result.problems);
  }
  return result.response;
}
