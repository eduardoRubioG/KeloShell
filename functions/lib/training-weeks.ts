/**
 * Transitional shim for callers still driven by configured session names
 * (lift-log, streaks, creatine-log). Removed once those slices move onto the
 * Training service.
 */
import type { LiftLogRequest } from '../../src/contracts/training';
import {
  readTrainingWeeksFromTabs,
  writeLiftLogToTabs,
  type TrainingSheetGateway,
} from '../coach-templates/coach-partner/training';
import { SESSION_NAMES } from './config';

export { SESSION_NAMES, SourceSpreadsheetSchemaError } from './config';
export { LiftLogConflictError } from '../coach-templates/coach-partner/training';
export type TrainingWeeksGateway = TrainingSheetGateway;

export function readTrainingWeeks(
  gateway: TrainingWeeksGateway,
  sessionNames: readonly string[] = SESSION_NAMES
) {
  return readTrainingWeeksFromTabs(gateway, sessionNames);
}

export function writeLiftLog(
  gateway: TrainingWeeksGateway,
  request: LiftLogRequest,
  sessionNames: readonly string[] = SESSION_NAMES
) {
  return writeLiftLogToTabs(gateway, request, sessionNames);
}
