import type {
  BodyweightResponse,
  DailyBodyweightEntry,
  DailyBodyweightRequest,
} from '../../src/contracts/body';
import type {
  MeasurementCheckInSaveRequest,
  MeasurementsResponse,
} from '../../src/contracts/measurements';
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

/** The outcome of a Lift Log write: saved, or refused with problems. */
export type LiftLogWriteResult =
  | { ok: true; response: TrainingWeeksResponse }
  | { ok: false; problems: FormatProblem[] };

/** Training behaviour of a Coach Template, in domain terms only. */
export interface TrainingTemplate {
  readTraining(gateway: SpreadsheetGateway): Promise<TrainingReport>;
  /**
   * Saves or clears one Lift Log. Throws LiftLogConflictError for a stale
   * revision or unavailable lift, and UnknownWorkoutSessionError for an
   * unknown session. Refuses without writing, reporting problems, when the
   * Training tabs cannot be interpreted.
   */
  writeLiftLog(
    gateway: SpreadsheetGateway,
    request: LiftLogRequest
  ): Promise<LiftLogWriteResult>;
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

/**
 * What a Coach Template found when reading Measurement Check-Ins across every
 * Tracking tab. `ok` is false when no Tracking tab yielded Measurement Fields;
 * otherwise problems in individual tabs are reported alongside a usable result.
 */
export type MeasurementsReport =
  | { ok: true; response: MeasurementsResponse; problems: FormatProblem[] }
  | { ok: false; problems: FormatProblem[] };

/** The outcome of a Measurement Check-In write: saved, or refused with problems. */
export type MeasurementCheckInWriteResult =
  | { ok: true; response: MeasurementsResponse }
  | { ok: false; problems: FormatProblem[] };

/** The outcome of a Daily Bodyweight write: saved, or refused with problems. */
export type TrackingWriteResult =
  | { ok: true; response: BodyweightResponse }
  | { ok: false; problems: FormatProblem[] };

/** Tracking behaviour of a Coach Template, in domain terms only. */
export interface TrackingTemplate {
  /** `today` is the Local Calendar Date, YYYY-MM-DD. */
  readTracking(
    gateway: SpreadsheetGateway,
    today: string
  ): Promise<TrackingReport>;
  /**
   * Lists Measurement Check-Ins from every Tracking tab in date order, each
   * dated within the year of its own tab.
   */
  readMeasurements(gateway: SpreadsheetGateway): Promise<MeasurementsReport>;
  /**
   * Saves or clears Daily Bodyweight for an existing date, whichever Tracking
   * tab holds it. Throws BodyweightConflictError for a stale revision or a
   * date not in the Source Spreadsheet. Refuses without writing, reporting
   * problems, when the date is duplicated across tabs.
   */
  writeDailyBodyweight(
    gateway: SpreadsheetGateway,
    request: DailyBodyweightRequest
  ): Promise<TrackingWriteResult>;
  /**
   * Saves the given Measurement Field values on the Measurement Check-In with
   * the request's date, in the Tracking tab it was read from; other fields
   * are left alone. Throws MeasurementCheckInConflictError for a stale
   * revision or a date that is not a check-in, and TypeError for unknown
   * fields or non-positive values. Refuses without writing, reporting
   * problems, when the date is duplicated across tabs.
   */
  writeMeasurementCheckIn(
    gateway: SpreadsheetGateway,
    request: MeasurementCheckInSaveRequest
  ): Promise<MeasurementCheckInWriteResult>;
}

export interface CoachTemplate {
  training: TrainingTemplate;
  tracking: TrackingTemplate;
}
