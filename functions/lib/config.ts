import type { SessionName } from '../../src/contracts/training';
import type { UserId } from './users';

export const BODYWEIGHT_SHEET_NAME = "Tracking '26";

/**
 * Workout Session tab names per user. Each coach structures the source
 * spreadsheet differently — Eduardo trains a 4-day upper/lower split, Emily a
 * 3-day full-body split — so both the tab names and their count are per-user.
 */
export const SESSION_NAMES_BY_USER = {
  eduardo: ['Upper A', 'Lower A', 'Upper B', 'Lower B'],
  emily: ['Full A', 'Full B', 'Full C'],
} as const satisfies Record<UserId, readonly SessionName[]>;

/**
 * Default session tabs (Eduardo's 4-day split). Used as the fallback when no
 * per-user list is supplied — chiefly by unit tests built on those fixtures.
 */
export const SESSION_NAMES = SESSION_NAMES_BY_USER.eduardo;

export const HABITS_SHEET_NAME = 'Habits';
export const CREATINE_HABIT_KEY = 'creatine';

export const STEPS_SHEET_NAME = 'Steps';

export class SourceSpreadsheetSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SourceSpreadsheetSchemaError';
  }
}
