import type { SessionName } from '../../src/contracts/training';

export const BODYWEIGHT_SHEET_NAME = "Tracking '26";

export const SESSION_NAMES = [
  'Upper A',
  'Lower A',
  'Upper B',
  'Lower B',
] as const satisfies readonly SessionName[];

export const HABITS_SHEET_NAME = 'Habits';
export const CREATINE_HABIT_KEY = 'creatine';

export const STEPS_SHEET_NAME = 'Steps';

export const PUSH_SUBSCRIPTIONS_KEY = 'push:subscriptions';
export const REMINDER_DELIVERY_KEY_PREFIX = 'push:reminders:';

export class SourceSpreadsheetSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SourceSpreadsheetSchemaError';
  }
}
