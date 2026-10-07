/** The programmed lift changed (or vanished) since the client loaded it. */
export class LiftLogConflictError extends Error {
  constructor(message = 'The Lift Log changed since it was loaded.') {
    super(message);
    this.name = 'LiftLogConflictError';
  }
}

/** A Lift Log named a Workout Session that the Source Spreadsheet does not have. */
export class UnknownWorkoutSessionError extends TypeError {
  constructor(session: string) {
    super(`"${session}" is not a Workout Session in the Source Spreadsheet.`);
    this.name = 'UnknownWorkoutSessionError';
  }
}
