import type {
  MeasurementCheckInSaveRequest,
  MeasurementsResponse,
} from '../../src/contracts/measurements';
import type {
  BodyweightResponse,
  DailyBodyweightEntry,
  DailyBodyweightRequest,
} from '../../src/contracts/body';
import {
  FORMAT_MESSAGE,
  logFormatProblems,
  SourceSpreadsheetSchemaError,
  type FormatProblem,
} from '../lib/format-problems';
import type { CoachTemplate, TrackingReport } from '../coach-templates/types';
import type { SpreadsheetGateway } from '../lib/spreadsheet-gateway';

export { BodyweightConflictError, MeasurementCheckInConflictError } from '../lib/body-errors';

function logProblems(problems: readonly FormatProblem[]): void {
  logFormatProblems('body', 'tracking-problems', problems);
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

/** Measurement Check-Ins from every Tracking tab, each dated within its own tab's year. */
export async function readMeasurements(
  gateway: SpreadsheetGateway,
  template: CoachTemplate
): Promise<MeasurementsResponse> {
  const report = await template.tracking.readMeasurements(gateway);
  logProblems(report.problems);
  if (!report.ok) {
    throw new SourceSpreadsheetSchemaError(FORMAT_MESSAGE, report.problems);
  }
  return report.response;
}

export async function writeMeasurementCheckIn(
  gateway: SpreadsheetGateway,
  template: CoachTemplate,
  request: MeasurementCheckInSaveRequest
): Promise<MeasurementsResponse> {
  const result = await template.tracking.writeMeasurementCheckIn(gateway, request);
  if (!result.ok) {
    logProblems(result.problems);
    throw new SourceSpreadsheetSchemaError(FORMAT_MESSAGE, result.problems);
  }
  return result.response;
}
