import type {
  LiftLogRequest,
  TrainingWeeksResponse,
} from '../../src/contracts/training';
import type { CoachTemplate } from '../coach-templates/types';
import type { SpreadsheetGateway } from '../lib/spreadsheet-gateway';

export function readTrainingWeeks(
  gateway: SpreadsheetGateway,
  template: CoachTemplate
): Promise<TrainingWeeksResponse> {
  return template.training.readTrainingWeeks(gateway);
}

export function writeLiftLog(
  gateway: SpreadsheetGateway,
  template: CoachTemplate,
  request: LiftLogRequest
): Promise<TrainingWeeksResponse> {
  return template.training.writeLiftLog(gateway, request);
}
