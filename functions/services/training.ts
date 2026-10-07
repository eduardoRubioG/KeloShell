import type {
  LiftLogRequest,
  TrainingWeeksResponse,
} from '../../src/contracts/training';
import type { CoachTemplate, TrainingReport } from '../coach-templates/types';
import { FORMAT_MESSAGE, SourceSpreadsheetSchemaError, type FormatProblem } from '../lib/format-problems';
import type { SpreadsheetGateway } from '../lib/spreadsheet-gateway';

export { LiftLogConflictError, UnknownWorkoutSessionError } from '../lib/lift-log-errors';

// Problems are logged here, not in the adapter, so they surface in the
// Cloudflare logs whichever Coach Template reported them.
function logProblems(problems: readonly FormatProblem[]): void {
  if (problems.length > 0) {
    console.warn('[training] source spreadsheet problems', {
      event: 'training-problems',
      problems,
    });
  }
}

export async function readTrainingReport(
  gateway: SpreadsheetGateway,
  template: CoachTemplate
): Promise<TrainingReport> {
  const report = await template.training.readTraining(gateway);
  logProblems(report.problems);
  return report;
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

export async function writeLiftLog(
  gateway: SpreadsheetGateway,
  template: CoachTemplate,
  request: LiftLogRequest
): Promise<TrainingWeeksResponse> {
  const result = await template.training.writeLiftLog(gateway, request);
  if (!result.ok) {
    logProblems(result.problems);
    throw new SourceSpreadsheetSchemaError(FORMAT_MESSAGE, result.problems);
  }
  return result.response;
}
