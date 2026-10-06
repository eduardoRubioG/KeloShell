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

export interface CoachTemplate {
  training: TrainingTemplate;
}
