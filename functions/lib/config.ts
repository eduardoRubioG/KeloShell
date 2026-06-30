import type { SessionName } from '../../src/contracts/training';

export const BODYWEIGHT_SHEET_NAME = "Tracking '26";

export const SESSION_NAMES = [
  'Upper A',
  'Lower A',
  'Upper B',
  'Lower B',
] as const satisfies readonly SessionName[];

export const PUSH_SUBSCRIPTIONS_KEY = 'push:subscriptions';

export class SourceSpreadsheetSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SourceSpreadsheetSchemaError';
  }
}
