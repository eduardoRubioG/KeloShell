import type {
  LiftLogRequest,
  TrainingWeeksResponse,
} from '../../src/contracts/training';
import type { CoachTemplate, TrainingReport } from '../coach-templates/types';
import { FORMAT_MESSAGE, SourceSpreadsheetSchemaError } from '../lib/format-problems';
import type { SpreadsheetGateway } from '../lib/spreadsheet-gateway';

export { LiftLogConflictError, UnknownWorkoutSessionError } from '../lib/lift-log-errors';

export function readTrainingReport(
  gateway: SpreadsheetGateway,
  template: CoachTemplate
): Promise<TrainingReport> {
  return template.training.readTraining(gateway);
}

export async function readTrainingWeeks(
  gateway: SpreadsheetGateway,
  template: CoachTemplate
): Promise<TrainingWeeksResponse> {
  const report = await readTrainingReport(gateway, template);
  if (!report.ok) {
    throw new SourceSpreadsheetSchemaError(FORMAT_MESSAGE, report.problems);
  }
  return report.trainingWeeks;
}

export function writeLiftLog(
  gateway: SpreadsheetGateway,
  template: CoachTemplate,
  request: LiftLogRequest
): Promise<TrainingWeeksResponse> {
  return template.training.writeLiftLog(gateway, request);
}
