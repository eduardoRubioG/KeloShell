import type {
  BodyweightResponse,
  DailyBodyweightEntry,
  DailyBodyweightRequest,
} from '../../src/contracts/body';
import type { CoachTemplate, TrackingReport } from '../coach-templates/types';
import type { SpreadsheetGateway } from '../lib/spreadsheet-gateway';

export { BodyweightConflictError } from '../lib/body-errors';

export function readTrackingReport(
  gateway: SpreadsheetGateway,
  template: CoachTemplate,
  today: string
): Promise<TrackingReport> {
  return template.tracking.readTracking(gateway, today);
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

export function writeDailyBodyweight(
  gateway: SpreadsheetGateway,
  template: CoachTemplate,
  request: DailyBodyweightRequest
): Promise<BodyweightResponse> {
  return template.tracking.writeDailyBodyweight(gateway, request);
}
