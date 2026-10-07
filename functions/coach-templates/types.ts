import type {
  BodyweightResponse,
  DailyBodyweightEntry,
  DailyBodyweightRequest,
} from '../../src/contracts/body';
import type {
  LiftLogRequest,
  TrainingWeeksResponse,
} from '../../src/contracts/training';
import type { FormatProblem } from '../lib/format-problems';
import type { SpreadsheetGateway } from '../lib/spreadsheet-gateway';

/**
 * What a Coach Template found when reading Training. `sessions` are the
 * discovered Workout Session names in Session Order (as far as discovered).
 * Blocking (structural) problems make `ok` false; lift-definition problems
 * are reported alongside a usable result.
 */
export type TrainingReport =
  | {
      ok: true;
      sessions: string[];
      trainingWeeks: TrainingWeeksResponse;
      problems: FormatProblem[];
    }
  | { ok: false; sessions: string[]; problems: FormatProblem[] };

/** Training behaviour of a Coach Template, in domain terms only. */
export interface TrainingTemplate {
  readTraining(gateway: SpreadsheetGateway): Promise<TrainingReport>;
  writeLiftLog(
    gateway: SpreadsheetGateway,
    request: LiftLogRequest
  ): Promise<TrainingWeeksResponse>;
}

/**
 * What a Coach Template found when reading Tracking. `entries` merge every
 * Tracking tab in date order; `todayEntry` is today's Daily Bodyweight, null
 * when no tab has a row for today (which is not a problem).
 */
export interface TrackingReport {
  /** False when the spreadsheet has no Tracking tab at all. */
  tabAvailable: boolean;
  entries: DailyBodyweightEntry[];
  todayEntry: DailyBodyweightEntry | null;
  problems: FormatProblem[];
}

/** Tracking behaviour of a Coach Template, in domain terms only. */
export interface TrackingTemplate {
  /** `today` is the Local Calendar Date, YYYY-MM-DD. */
  readTracking(
    gateway: SpreadsheetGateway,
    today: string
  ): Promise<TrackingReport>;
  /**
   * Saves or clears Daily Bodyweight for an existing date, whichever Tracking
   * tab holds it. Throws BodyweightConflictError for a stale revision or a
   * date not in the Source Spreadsheet, and SourceSpreadsheetSchemaError when
   * the date is duplicated across tabs.
   */
  writeDailyBodyweight(
    gateway: SpreadsheetGateway,
    request: DailyBodyweightRequest
  ): Promise<BodyweightResponse>;
}

export interface CoachTemplate {
  training: TrainingTemplate;
  tracking: TrackingTemplate;
}
