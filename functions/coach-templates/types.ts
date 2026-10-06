import type {
  LiftLogRequest,
  TrainingWeeksResponse,
} from '../../src/contracts/training';
import type { SpreadsheetGateway } from '../lib/spreadsheet-gateway';

/** Training behaviour of a Coach Template, in domain terms only. */
export interface TrainingTemplate {
  readTrainingWeeks(gateway: SpreadsheetGateway): Promise<TrainingWeeksResponse>;
  writeLiftLog(
    gateway: SpreadsheetGateway,
    request: LiftLogRequest
  ): Promise<TrainingWeeksResponse>;
}

export interface CoachTemplate {
  training: TrainingTemplate;
}
